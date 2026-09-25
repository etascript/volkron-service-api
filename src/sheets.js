import { google } from 'googleapis';
import { config } from './config.js';
import { normalizeDate } from './calendar.js';

const HEADERS = [
  'created_at',
  'status',
  'nombre',
  'rut',
  'telefono',
  'email',
  'region',
  'comuna',
  'tipo_servicio',
  'servicio_origen',
  'fecha_visita',
  'horario',
  'detalle',
  'source',
  'user_agent',
];

let sheetsClient;

const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'rechazada', 'cancelada', 'lost', 'reprobado']);

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  if (!config.googleSheetsEnabled) throw new Error('Google Sheets is disabled');
  if (!config.sheetId || !config.serviceAccountEmail || !config.privateKey) {
    throw new Error('Google Sheets credentials are incomplete');
  }

  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function tabRange(range) {
  return `'${config.sheetTab}'!${range}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function normalizeSheetDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoLike = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoLike) return normalizeDate(`${isoLike[1]}-${pad(isoLike[2])}-${pad(isoLike[3])}`) || '';

  const localLike = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (localLike) return normalizeDate(`${localLike[3]}-${pad(localLike[2])}-${pad(localLike[1])}`) || '';

  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + serial * 24 * 60 * 60 * 1000);
    return normalizeDate(date.toISOString().slice(0, 10)) || '';
  }

  return normalizeDate(raw) || '';
}

function normalizeSheetSlot(value) {
  const raw = String(value || '').trim();
  const matches = [...raw.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (matches.length < 2) return raw;

  const [start, end] = matches;
  return `${pad(start[1])}:${start[2]} - ${pad(end[1])}:${end[2]}`;
}

export async function ensureHeaders() {
  if (!config.googleSheetsEnabled) return;
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: tabRange('A1:O1'),
  });

  const existing = response.data.values?.[0] || [];
  if (existing.length > 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: tabRange('A1:O1'),
    valueInputOption: 'RAW',
    requestBody: {
      values: [HEADERS],
    },
  });
}

export async function appendQuote(quote, meta = {}) {
  if (!config.googleSheetsEnabled) return;
  await ensureHeaders();

  const sheets = getSheetsClient();
  const row = [
    meta.createdAt || new Date().toISOString(),
    'pending',
    quote.nombre,
    quote.rut,
    quote.telefono,
    quote.email,
    quote.region,
    quote.comuna,
    quote.tipo_servicio,
    quote.servicio_origen || '',
    quote.fecha_visita || '',
    quote.horario || '',
    quote.detalle || '',
    meta.source || '',
    meta.userAgent || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: tabRange('A:O'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });
}

export async function getReservedSlots(month) {
  const counts = await getReservedSlotCounts(month);
  const reservedByDate = new Map();

  for (const key of counts.keys()) {
    const [fechaVisita, horario] = key.split('|');
    if (!reservedByDate.has(fechaVisita)) reservedByDate.set(fechaVisita, new Set());
    reservedByDate.get(fechaVisita).add(horario);
  }

  return reservedByDate;
}

export async function getReservedSlotCounts(month) {
  if (!config.googleSheetsEnabled) return new Map();
  await ensureHeaders();

  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: tabRange('A2:O'),
  });

  const values = response.data.values || [];
  const counts = new Map();

  values.forEach((row) => {
    const status = (row[1] || '').toLowerCase();
    const fechaVisita = normalizeSheetDate(row[10]);
    const horario = normalizeSheetSlot(row[11]);

    if (!fechaVisita.startsWith(month)) return;
    if (!horario) return;
    if (INACTIVE_STATUSES.has(status)) return;

    const key = `${fechaVisita}|${horario}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
}
