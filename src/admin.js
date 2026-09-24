import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { decryptRecord, encryptRecord, readQuoteBackups } from './backups.js';

export const QUOTE_STATUSES = [
  'received',
  'pending',
  'contacted',
  'quoted',
  'scheduled',
  'won',
  'lost',
  'cancelled',
];

const statusSchema = z.object({
  status: z.enum(QUOTE_STATUSES),
  note: z.string().trim().max(500).optional().default(''),
});

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function quoteSearchText(item) {
  const quote = item.quote || {};
  return normalize([
    item.id,
    item.created_at,
    item.status,
    quote.nombre,
    quote.rut,
    quote.telefono,
    quote.email,
    quote.region,
    quote.comuna,
    quote.tipo_servicio,
    quote.servicio_origen,
    quote.fecha_visita,
    quote.horario,
    quote.detalle,
  ].join(' '));
}

async function readJsonl(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
        return decryptRecord(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readStatusEvents() {
  const events = await readJsonl(config.statusEventsFile);
  const latestById = new Map();

  events.forEach((event) => {
    if (!event.quote_id || !event.status) return;
    latestById.set(event.quote_id, event);
  });

  return latestById;
}

function applyFilters(items, query) {
  const q = normalize(query.q);
  const status = normalize(query.status);
  const region = normalize(query.region);
  const comuna = normalize(query.comuna);
  const service = normalize(query.service);
  const from = String(query.from || '');
  const to = String(query.to || '');

  return items.filter((item) => {
    const quote = item.quote || {};
    if (q && !quoteSearchText(item).includes(q)) return false;
    if (status && normalize(item.status) !== status) return false;
    if (region && !normalize(quote.region).includes(region)) return false;
    if (comuna && !normalize(quote.comuna).includes(comuna)) return false;
    if (service && !normalize(quote.tipo_servicio).includes(service)) return false;
    if (from && String(item.created_at || '').slice(0, 10) < from) return false;
    if (to && String(item.created_at || '').slice(0, 10) > to) return false;
    return true;
  });
}

function uniqueOptions(items, field) {
  const values = new Set();
  items.forEach((item) => {
    const value = field === 'status' ? item.status : item.quote?.[field];
    if (value) values.add(value);
  });
  return [...values].sort((a, b) => a.localeCompare(b, 'es'));
}

export async function listQuotes(query = {}) {
  const statusEvents = await readStatusEvents();
  const records = await readQuoteBackups();

  const normalizedRecords = records
    .filter((record) => record.id && record.quote)
    .map((record) => {
      const statusEvent = statusEvents.get(record.id);
      return {
        id: record.id,
        created_at: record.created_at,
        status: statusEvent?.status || record.status || 'received',
        status_note: statusEvent?.note || '',
        status_changed_at: statusEvent?.changed_at || '',
        quote: record.quote,
        meta: record.meta || {},
      };
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const filtered = applyFilters(normalizedRecords, query);
  const limit = Math.min(Math.max(Number(query.limit || 200), 1), 1000);
  const offset = Math.max(Number(query.offset || 0), 0);

  return {
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
    filters: {
      statuses: QUOTE_STATUSES,
      regions: uniqueOptions(normalizedRecords, 'region'),
      comunas: uniqueOptions(normalizedRecords, 'comuna'),
      services: uniqueOptions(normalizedRecords, 'tipo_servicio'),
    },
  };
}

export async function getReservedSlotsFromAdmin(month) {
  const quotes = await listQuotes({ limit: 1000 });
  const reservedByDate = new Map();

  quotes.items.forEach((item) => {
    const status = String(item.status || '').toLowerCase();
    const fechaVisita = item.quote?.fecha_visita || '';
    const horario = item.quote?.horario || '';

    if (!fechaVisita.startsWith(month)) return;
    if (!horario) return;
    if (['cancelled', 'canceled', 'rechazada', 'cancelada', 'lost'].includes(status)) return;

    if (!reservedByDate.has(fechaVisita)) reservedByDate.set(fechaVisita, new Set());
    reservedByDate.get(fechaVisita).add(horario);
  });

  return reservedByDate;
}

export async function appendStatusEvent(quoteId, payload) {
  const parsed = statusSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: 'Estado invalido',
        issues: parsed.error.issues,
      },
    };
  }

  const quotes = await listQuotes({ limit: 1000 });
  const exists = quotes.items.some((item) => item.id === quoteId);
  if (!exists) {
    return {
      ok: false,
      status: 404,
      body: { ok: false, message: 'Cotizacion no encontrada' },
    };
  }

  const event = {
    quote_id: quoteId,
    status: parsed.data.status,
    note: parsed.data.note,
    changed_at: new Date().toISOString(),
  };

  await mkdir(path.dirname(config.statusEventsFile), { recursive: true });
  await appendFile(config.statusEventsFile, `${JSON.stringify(encryptRecord(event))}\n`, 'utf8');

  return {
    ok: true,
    status: 201,
    body: { ok: true, event },
  };
}
