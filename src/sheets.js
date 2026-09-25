import { google } from 'googleapis';
import { config } from './config.js';

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
    const fechaVisita = row[10] || '';
    const horario = row[11] || '';

    if (!fechaVisita.startsWith(month)) return;
    if (!horario) return;
    if (['cancelled', 'canceled', 'rechazada', 'cancelada'].includes(status)) return;

    const key = `${fechaVisita}|${horario}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
}
