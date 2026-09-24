import { mkdir, appendFile, readdir, readFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';

const ENCRYPTION_ALG = 'aes-256-gcm';

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function backupFilePath(date) {
  return path.join(config.backupDir, `${monthKey(date)}.jsonl`);
}

function encryptionKey() {
  const key = Buffer.from(config.backupEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  }
  return key;
}

export function encryptRecord(record) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALG, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: ENCRYPTION_ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

export function decryptRecord(line) {
  const parsed = JSON.parse(line);
  if (!parsed || parsed.v !== 1 || parsed.alg !== ENCRYPTION_ALG) return parsed;

  const decipher = createDecipheriv(ENCRYPTION_ALG, encryptionKey(), Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

export function buildQuoteRecord(quote, meta = {}) {
  const createdAt = meta.createdAt || new Date().toISOString();
  return {
    id: meta.requestId,
    created_at: createdAt,
    status: 'received',
    quote: {
      nombre: quote.nombre,
      rut: quote.rut,
      telefono: quote.telefono,
      email: quote.email,
      region: quote.region,
      comuna: quote.comuna,
      tipo_servicio: quote.tipo_servicio,
      servicio_origen: quote.servicio_origen || '',
      fecha_visita: quote.fecha_visita || '',
      horario: quote.horario || '',
      detalle: quote.detalle || '',
    },
    meta: {
      source: meta.source || '',
      user_agent: meta.userAgent || '',
    },
  };
}

export async function appendQuoteBackup(quote, meta = {}) {
  const record = buildQuoteRecord(quote, meta);
  const createdDate = new Date(record.created_at);

  await mkdir(config.backupDir, { recursive: true });
  await appendFile(backupFilePath(createdDate), `${JSON.stringify(encryptRecord(record))}\n`, 'utf8');
}

async function quoteBackupFiles() {
  try {
    const entries = await readdir(config.backupDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(config.backupDir, entry.name))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readQuoteFile(filePath) {
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
}

export async function readQuoteBackups() {
  const files = await quoteBackupFiles();
  const records = [];

  for (const file of files) {
    records.push(...(await readQuoteFile(file)));
  }

  return records;
}

export async function getReservedSlotsFromBackups(month) {
  const records = await readQuoteBackups();
  const reservedByDate = new Map();

  records.forEach((record) => {
    const status = String(record.status || '').toLowerCase();
    const fechaVisita = record.quote?.fecha_visita || '';
    const horario = record.quote?.horario || '';

    if (!fechaVisita.startsWith(month)) return;
    if (!horario) return;
    if (['cancelled', 'canceled', 'rechazada', 'cancelada', 'lost'].includes(status)) return;

    if (!reservedByDate.has(fechaVisita)) reservedByDate.set(fechaVisita, new Set());
    reservedByDate.get(fechaVisita).add(horario);
  });

  return reservedByDate;
}
