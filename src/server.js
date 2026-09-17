import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { config } from './config.js';
import {
  buildMonthAvailability,
  currentMonthKey,
  isDateSelectable,
  normalizeDate,
  normalizeMonthFromDate,
} from './calendar.js';
import { appendQuote, getReservedSlots } from './sheets.js';
import { quoteSchema } from './validation.js';
import { getHolidays, getHolidaySet } from './holidays.js';

const logger = pino({ level: config.nodeEnv === 'production' ? 'info' : 'debug' });
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }),
);
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/availability', async (req, res, next) => {
  try {
    const month = String(req.query.month || currentMonthKey());
    const holidays = await getHolidaySet();
    const reservedByDate = await getReservedSlots(month);
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
      const reservedByDate = await getReservedSlots(month);
      if (!isDateSelectable(normalizedDate, reservedByDate, quote.horario, holidays)) {
        return res.status(409).json({ ok: false, message: 'El horario seleccionado ya no esta disponible' });
      }
    }

    await appendQuote(quote, {
      source: req.get('origin') || req.get('referer') || '',
      userAgent: req.get('user-agent') || '',
    });

    res.status(201).json({ ok: true });
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
