import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalPrivateKey(name) {
  const value = process.env[name];
  return value ? value.replace(/\\n/g, '\n') : '';
}

function list(name, fallback = '') {
  return (process.env[name] || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  googleSheetsEnabled: process.env.GOOGLE_SHEETS_ENABLED === 'true',
  sheetId: process.env.GOOGLE_SHEET_ID || '',
  sheetTab: process.env.GOOGLE_SHEET_TAB || 'Cotizaciones',
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  privateKey: optionalPrivateKey('GOOGLE_PRIVATE_KEY'),
  availableSlots: list(
    'AVAILABLE_SLOTS',
    '09:00 - 11:00,11:00 - 13:00,14:00 - 16:00,16:00 - 18:00',
  ),
  holidays: new Set(list('HOLIDAYS')),
  holidaysApiUrl: process.env.HOLIDAYS_API_URL || 'https://api.roison.cl/feriados.json',
  holidaysCacheTtlMs: Number(process.env.HOLIDAYS_CACHE_TTL_MS || 12 * 60 * 60 * 1000),
  lookaheadMonths: Number(process.env.LOOKAHEAD_MONTHS || 6),
  backupDir: process.env.BACKUP_DIR || './data/quotes',
  statusEventsFile: process.env.STATUS_EVENTS_FILE || './data/status-events.jsonl',
  backupEncryptionKey: required('BACKUP_ENCRYPTION_KEY'),
  adminUser: process.env.ADMIN_USER || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
};
