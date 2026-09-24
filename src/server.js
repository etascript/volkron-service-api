import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  buildMonthAvailability,
  currentMonthKey,
  isDateSelectable,
  normalizeDate,
  normalizeMonthFromDate,
} from './calendar.js';
import { appendQuote } from './sheets.js';
import { quoteSchema } from './validation.js';
import { getHolidays, getHolidaySet } from './holidays.js';
import { appendQuoteBackup } from './backups.js';
import { appendStatusEvent, getReservedSlotsFromAdmin, listQuotes } from './admin.js';

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

function adminAuth(req, res, next) {
  if (!config.adminUser || !config.adminPassword) {
    logger.error('admin auth is not configured');
    return res.status(503).send('Admin no configurado');
  }

  const header = req.get('authorization') || '';
  const [scheme, credentials] = header.split(' ');

  if (scheme !== 'Basic' || !credentials) {
    res.set('WWW-Authenticate', 'Basic realm="Volkron Admin", charset="UTF-8"');
    return res.status(401).send('Autenticacion requerida');
  }

  const decoded = Buffer.from(credentials, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const user = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';

  if (!safeCompare(user, config.adminUser) || !safeCompare(password, config.adminPassword)) {
    res.set('WWW-Authenticate', 'Basic realm="Volkron Admin", charset="UTF-8"');
    return res.status(401).send('Credenciales invalidas');
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
app.use('/admin', adminAuth);
app.use('/admin/assets', express.static(path.join(publicDir, 'admin'), { index: false, maxAge: '1h' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'volkron-servicios-api',
    message: 'Volkron Servicios API operativa',
    endpoints: {
      health: '/health',
      availability: '/api/availability?month=YYYY-MM',
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
    const reservedByDate = await getReservedSlotsFromAdmin(month);
    res.json(buildMonthAvailability(month, reservedByDate, holidays));
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

app.get(['/admin', '/admin/'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin', 'index.html'));
});

app.get('/admin/api/quotes', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await listQuotes(req.query));
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

      const month = normalizeMonthFromDate(normalizedDate);
      const holidays = await getHolidaySet();
      const reservedByDate = await getReservedSlotsFromAdmin(month);
      if (!isDateSelectable(normalizedDate, reservedByDate, quote.horario, holidays)) {
        return res.status(409).json({ ok: false, message: 'El horario seleccionado ya no esta disponible' });
      }
    }

    const meta = {
      requestId: randomUUID(),
      createdAt: new Date().toISOString(),
      source: req.get('origin') || req.get('referer') || '',
      userAgent: req.get('user-agent') || '',
    };

    await appendQuoteBackup(quote, meta);
    try {
      await appendQuote(quote, meta);
    } catch (error) {
      logger.error({ error }, 'google sheets append failed');
    }

    res.status(201).json({ ok: true, id: meta.requestId });
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
