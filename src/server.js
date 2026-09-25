import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  currentMonthKey,
  normalizeDate,
} from './calendar.js';
import { appendQuote } from './sheets.js';
import { quoteSchema } from './validation.js';
import { getHolidays, getHolidaySet } from './holidays.js';
import { appendQuoteBackup } from './backups.js';
import {
  appendStatusEvent,
  createManualQuote,
  deleteQuote,
  getFormSchedule,
  getSettings,
  getStats,
  listQuotes,
  saveFormSchedule,
  updateSettings,
} from './admin.js';
import { createSubmission } from './forms.js';
import { authenticateAdminUser, createPasswordReset, getValidPasswordReset, resetPasswordWithToken } from './admin-users.js';
import { sendPasswordResetEmail } from './mail.js';
import { buildFormAvailability, isFormDateSelectable } from './schedule.js';

const logger = pino({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.get('cookie') || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=');
        return index >= 0 ? [item.slice(0, index), decodeURIComponent(item.slice(index + 1))] : [item, ''];
      }),
  );
}

function signSession(payload) {
  return createHmac('sha256', config.adminSessionSecret).update(payload).digest('base64url');
}

function createSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    email: user.email,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${signSession(payload)}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return false;
  if (!safeCompare(signature, signSession(payload))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Boolean(session.id) && Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(value) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  return `volkron_admin=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`;
}

function clearSessionCookie() {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  return `volkron_admin=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function wantsJson(req) {
  return req.path.startsWith('/admin/api') || req.get('accept')?.includes('application/json');
}

function adminSessionAuth(req, res, next) {
  if (!verifySessionToken(parseCookies(req).volkron_admin)) {
    if (wantsJson(req)) return res.status(401).json({ ok: false, message: 'Sesion requerida' });
    return res.redirect('/admin/login');
  }

  return next();
}

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }),
);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  '/admin/assets',
  express.static(path.join(publicDir, 'admin'), {
    index: false,
    maxAge: 0,
    setHeaders(res) {
      res.set('Cache-Control', 'no-store');
    },
  }),
);

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'volkron-servicios-api',
    message: 'Volkron Servicios API operativa',
    endpoints: {
      health: '/health',
      availability: '/api/availability?month=YYYY-MM',
      formAvailability: '/api/forms/cotizacion/availability?month=YYYY-MM',
      holidays: '/api/holidays?year=YYYY',
      quote: '/api/quote',
      admin: '/admin',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/availability', async (req, res, next) => {
  try {
    const month = String(req.query.month || currentMonthKey());
    const holidays = await getHolidaySet();
    res.json(await buildFormAvailability('cotizacion', month, holidays));
  } catch (error) {
    next(error);
  }
});

app.get('/api/forms/:slug/availability', async (req, res, next) => {
  try {
    const month = String(req.query.month || currentMonthKey());
    const holidays = await getHolidaySet();
    res.json(await buildFormAvailability(req.params.slug, month, holidays));
  } catch (error) {
    next(error);
  }
});

app.get('/api/holidays', async (req, res, next) => {
  try {
    const year = String(req.query.year || '');
    const holidays = await getHolidays({ force: req.query.refresh === 'true' });
    res.json({
      holidays: year ? holidays.filter((holiday) => holiday.date.startsWith(`${year}-`)) : holidays,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/admin/login', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const user = String(req.body.user || '');
  const password = String(req.body.password || '');
  const adminUser = authenticateAdminUser(user, password);
  if (!adminUser) {
    return res.redirect('/admin/login?error=1');
  }

  res.set('Set-Cookie', sessionCookie(createSessionToken(adminUser)));
  return res.redirect('/admin');
});

app.get('/admin/forgot-password', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'forgot-password.html'));
});

app.post('/admin/forgot-password', async (req, res, next) => {
  try {
    const reset = createPasswordReset(req.body.email);
    if (reset) {
      const result = await sendPasswordResetEmail(reset);
      if (!result.sent) logger.warn({ resetUrl: result.url }, 'smtp not configured; password reset link generated');
    }
    return res.redirect('/admin/forgot-password?sent=1');
  } catch (error) {
    next(error);
  }
});

app.get('/admin/reset-password', (req, res) => {
  if (!getValidPasswordReset(req.query.token)) return res.redirect('/admin/forgot-password?invalid=1');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'reset-password.html'));
});

app.post('/admin/reset-password', (req, res) => {
  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.password_confirm || '');
  if (password !== passwordConfirm) return res.redirect('/admin/reset-password?token=' + encodeURIComponent(req.body.token || '') + '&error=match');

  const result = resetPasswordWithToken(req.body.token, password);
  if (!result.ok) return res.redirect('/admin/forgot-password?invalid=1');
  return res.redirect('/admin/login?reset=1');
});

app.use('/admin', (req, res, next) => {
  if (['/login', '/forgot-password', '/reset-password'].includes(req.path)) return next();
  return adminSessionAuth(req, res, next);
});

app.get(['/admin', '/admin/'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'index.html'));
});

app.get('/admin/stats', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'stats.html'));
});

app.get('/admin/new', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'quote-form.html'));
});

app.get('/admin/settings', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'settings.html'));
});

app.get('/admin/schedule', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'schedule.html'));
});

app.post('/admin/logout', (_req, res) => {
  res.set('Set-Cookie', clearSessionCookie());
  res.redirect('/admin/login');
});

app.get('/admin/api/quotes', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await listQuotes(req.query));
  } catch (error) {
    next(error);
  }
});

app.post('/admin/api/quotes', async (req, res, next) => {
  try {
    const result = await createManualQuote(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.get('/admin/api/stats', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getStats());
  } catch (error) {
    next(error);
  }
});

app.get('/admin/api/settings', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getSettings());
  } catch (error) {
    next(error);
  }
});

app.post('/admin/api/settings', async (req, res, next) => {
  try {
    const result = await updateSettings(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.get('/admin/api/forms/:slug/schedule', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getFormSchedule(req.params.slug));
  } catch (error) {
    next(error);
  }
});

app.put('/admin/api/forms/:slug/schedule', async (req, res, next) => {
  try {
    const result = await saveFormSchedule(req.params.slug, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.post('/admin/api/quotes/:id/status', async (req, res, next) => {
  try {
    const result = await appendStatusEvent(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.delete('/admin/api/quotes/:id', async (req, res, next) => {
  try {
    const result = await deleteQuote(req.params.id, req.body || {});
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.post('/api/quote', async (req, res, next) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        message: 'Datos invalidos',
        issues: parsed.error.issues,
      });
    }

    const quote = parsed.data;
    if (quote.website) return res.status(204).end();

    if (quote.fecha_visita || quote.horario) {
      if (!quote.fecha_visita || !quote.horario) {
        return res.status(400).json({ ok: false, message: 'Fecha y horario deben enviarse juntos' });
      }

      const normalizedDate = normalizeDate(quote.fecha_visita);
      if (!normalizedDate) {
        return res.status(400).json({ ok: false, message: 'Fecha de visita invalida' });
      }

      const holidays = await getHolidaySet();
      if (!await isFormDateSelectable('cotizacion', normalizedDate, quote.horario, holidays)) {
        return res.status(409).json({ ok: false, message: 'El horario seleccionado ya no esta disponible' });
      }
    }

    const meta = {
      requestId: randomUUID(),
      createdAt: new Date().toISOString(),
      source: req.get('origin') || req.get('referer') || '',
      userAgent: req.get('user-agent') || '',
    };

    createSubmission('cotizacion', quote, meta);
    await appendQuoteBackup(quote, meta);
    await appendQuote(quote, meta);

    res.status(201).json({ ok: true, id: meta.requestId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/forms/:slug/submissions', async (req, res, next) => {
  try {
    if (req.body?.website) return res.status(204).end();
    const meta = {
      requestId: randomUUID(),
      createdAt: new Date().toISOString(),
      source: req.get('origin') || req.get('referer') || '',
      userAgent: req.get('user-agent') || '',
    };
    const id = createSubmission(req.params.slug, req.body || {}, meta);
    res.status(201).json({ ok: true, id });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  logger.error({ error }, 'request failed');
  res.status(500).json({
    ok: false,
    message: 'Error interno',
  });
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'volkron servicios api listening');
});
