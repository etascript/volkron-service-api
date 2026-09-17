import { config } from './config.js';

let cache = {
  expiresAt: 0,
  holidays: [],
  holidaySet: new Set(config.holidays),
};

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function normalizeHoliday(raw) {
  const date = raw.date || raw.fecha;
  if (!isDate(date)) return null;

  return {
    date,
    title: raw.title || raw.name || raw.nombre || 'Feriado',
    type: raw.type || raw.tipo || '',
    is_irrenunciable: Boolean(raw.is_irrenunciable || raw.irrenunciable),
  };
}

function normalizePayload(payload) {
  const source = Array.isArray(payload) ? payload : payload.data || payload.feriados || [];
  return source.map(normalizeHoliday).filter(Boolean);
}

async function fetchRemoteHolidays() {
  if (!config.holidaysApiUrl) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(config.holidaysApiUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Holiday API responded ${response.status}`);
    return normalizePayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function getHolidays({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.expiresAt > now) return cache.holidays;

  try {
    const remoteHolidays = await fetchRemoteHolidays();
    const manualHolidays = [...config.holidays].map((date) => ({ date, title: 'Feriado manual' }));
    const byDate = new Map();

    [...manualHolidays, ...remoteHolidays].forEach((holiday) => {
      byDate.set(holiday.date, holiday);
    });

    cache = {
      expiresAt: now + config.holidaysCacheTtlMs,
      holidays: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      holidaySet: new Set(byDate.keys()),
    };
  } catch (_error) {
    const manualHolidays = [...config.holidays].map((date) => ({ date, title: 'Feriado manual' }));
    cache = {
      expiresAt: now + Math.min(config.holidaysCacheTtlMs, 60 * 60 * 1000),
      holidays: manualHolidays,
      holidaySet: new Set(config.holidays),
    };
  }

  return cache.holidays;
}

export async function getHolidaySet(options) {
  await getHolidays(options);
  return cache.holidaySet;
}
