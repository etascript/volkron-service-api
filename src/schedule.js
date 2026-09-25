import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from './db.js';
import { config } from './config.js';
import { normalizeDate, toDateKey } from './calendar.js';
import { getReservedSlotCounts } from './sheets.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLIDAY_MODES = new Set(['none', 'national_block', 'manual_only', 'custom']);
const DAY_TYPES = new Set(['weekday', 'weekend', 'holiday']);
const OVERRIDE_MODES = new Set(['blocked', 'custom_slots', 'extra_slots']);
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'rechazada', 'cancelada', 'lost', 'reprobado']);

const slotSchema = z.object({
  id: z.string().optional(),
  dayType: z.enum(['weekday', 'weekend', 'holiday']),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.number().int().min(1).max(100).default(1),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const overrideSlotSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.number().int().min(1).max(100).default(1),
  sortOrder: z.number().int().default(0),
});

const overrideSchema = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['blocked', 'custom_slots', 'extra_slots']),
  reason: z.string().trim().max(200).optional().default(''),
  slots: z.array(overrideSlotSchema).default([]),
});

const scheduleSchema = z.object({
  settings: z.object({
    enabled: z.boolean().default(true),
    timezone: z.string().trim().min(3).max(80).default('America/Santiago'),
    lookaheadMonths: z.number().int().min(1).max(24).default(6),
    holidayMode: z.enum(['none', 'national_block', 'manual_only', 'custom']).default('national_block'),
  }),
  slots: z.array(slotSchema).default([]),
  overrides: z.array(overrideSchema).default([]),
});

function nowIso() {
  return new Date().toISOString();
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function labelForSlot(slot) {
  return `${slot.startTime} - ${slot.endTime}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isPast(date) {
  return startOfDay(date).getTime() < startOfDay(new Date()).getTime();
}

function isBeyondLookahead(date, months) {
  const limit = new Date();
  limit.setMonth(limit.getMonth() + months);
  return startOfDay(date).getTime() > startOfDay(limit).getTime();
}

function parseMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('month must use YYYY-MM format');
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month is invalid');
  return { year, monthIndex: monthNumber - 1 };
}

function getForm(slug) {
  return getDb().prepare('SELECT id, slug, name FROM forms WHERE slug = ? AND status = ?').get(slug, 'active');
}

function normalizeSlot(row) {
  return {
    id: row.id,
    dayType: row.day_type,
    weekday: row.weekday == null ? null : Number(row.weekday),
    startTime: row.start_time,
    endTime: row.end_time,
    capacity: Number(row.capacity || 1),
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order || 0),
  };
}

function normalizeOverride(row, slots = []) {
  return {
    id: row.id,
    date: row.date,
    mode: row.mode,
    reason: row.reason || '',
    slots,
  };
}

export function getSchedule(formSlug = 'cotizacion') {
  const database = getDb();
  const form = getForm(formSlug);
  if (!form) throw new Error(`Form not found: ${formSlug}`);

  const settings = database.prepare(`
    SELECT enabled, timezone, lookahead_months, holiday_mode
    FROM form_schedule_settings
    WHERE form_id = ?
  `).get(form.id) || {
    enabled: 1,
    timezone: 'America/Santiago',
    lookahead_months: config.lookaheadMonths,
    holiday_mode: 'national_block',
  };

  const slots = database.prepare(`
    SELECT *
    FROM form_schedule_slots
    WHERE form_id = ?
    ORDER BY sort_order ASC, weekday ASC, start_time ASC
  `).all(form.id).map(normalizeSlot);

  const overrides = database.prepare(`
    SELECT *
    FROM form_schedule_overrides
    WHERE form_id = ?
    ORDER BY date ASC
  `).all(form.id);

  const overrideSlots = database.prepare(`
    SELECT *
    FROM form_schedule_override_slots
    WHERE override_id = ?
    ORDER BY sort_order ASC, start_time ASC
  `);

  return {
    form: { id: form.id, slug: form.slug, name: form.name },
    settings: {
      enabled: Boolean(settings.enabled),
      timezone: settings.timezone,
      lookaheadMonths: Number(settings.lookahead_months),
      holidayMode: settings.holiday_mode,
    },
    slots,
    overrides: overrides.map((override) => normalizeOverride(
      override,
      overrideSlots.all(override.id).map((slot) => ({
        id: slot.id,
        startTime: slot.start_time,
        endTime: slot.end_time,
        capacity: Number(slot.capacity || 1),
        sortOrder: Number(slot.sort_order || 0),
      })),
    )),
  };
}

export function updateSchedule(formSlug, payload) {
  const parsed = scheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { ok: false, message: 'Agenda invalida', issues: parsed.error.issues } };
  }

  const database = getDb();
  const form = getForm(formSlug);
  if (!form) return { ok: false, status: 404, body: { ok: false, message: 'Formulario no encontrado' } };

  const data = parsed.data;
  const now = nowIso();

  database.transaction(() => {
    database.prepare(`
      INSERT INTO form_schedule_settings
        (form_id, enabled, timezone, lookahead_months, holiday_mode, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(form_id) DO UPDATE SET
        enabled = excluded.enabled,
        timezone = excluded.timezone,
        lookahead_months = excluded.lookahead_months,
        holiday_mode = excluded.holiday_mode,
        updated_at = excluded.updated_at
    `).run(
      form.id,
      data.settings.enabled ? 1 : 0,
      data.settings.timezone,
      data.settings.lookaheadMonths,
      data.settings.holidayMode,
      now,
      now,
    );

    database.prepare('DELETE FROM form_schedule_slots WHERE form_id = ?').run(form.id);
    const insertSlot = database.prepare(`
      INSERT INTO form_schedule_slots
        (id, form_id, day_type, weekday, start_time, end_time, capacity, enabled, sort_order, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    data.slots.forEach((slot, index) => {
      insertSlot.run(
        slot.id || randomUUID(),
        form.id,
        slot.dayType,
        slot.dayType === 'weekday' ? slot.weekday : null,
        slot.startTime,
        slot.endTime,
        slot.capacity,
        slot.enabled ? 1 : 0,
        slot.sortOrder || index * 10,
        now,
        now,
      );
    });

    database.prepare('DELETE FROM form_schedule_overrides WHERE form_id = ?').run(form.id);
    const insertOverride = database.prepare(`
      INSERT INTO form_schedule_overrides
        (id, form_id, date, mode, reason, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOverrideSlot = database.prepare(`
      INSERT INTO form_schedule_override_slots
        (id, override_id, start_time, end_time, capacity, sort_order, created_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);
    data.overrides.forEach((override) => {
      const overrideId = override.id || randomUUID();
      insertOverride.run(overrideId, form.id, override.date, override.mode, override.reason, now, now);
      override.slots.forEach((slot, index) => {
        insertOverrideSlot.run(
          randomUUID(),
          overrideId,
          slot.startTime,
          slot.endTime,
          slot.capacity,
          slot.sortOrder || index * 10,
          now,
        );
      });
    });
  })();

  return { ok: true, status: 200, body: { ok: true, schedule: getSchedule(formSlug) } };
}

function reservationCountsFromSqlite(formId, month) {
  const rows = getDb().prepare(`
    SELECT
      date_value.value AS date,
      slot_value.value AS slot,
      s.status
    FROM submissions s
    JOIN submission_values date_value ON date_value.submission_id = s.id AND date_value.field_name = 'fecha_visita'
    JOIN submission_values slot_value ON slot_value.submission_id = s.id AND slot_value.field_name = 'horario'
    WHERE s.form_id = ?
      AND s.deleted_at IS NULL
      AND date_value.value LIKE ?
  `).all(formId, `${month}-%`);

  const counts = new Map();
  rows.forEach((row) => {
    if (!row.date || !row.slot || INACTIVE_STATUSES.has(String(row.status || '').toLowerCase())) return;
    const key = `${row.date}|${row.slot}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

async function reservationCounts(formId, month) {
  if (config.googleSheetsEnabled) return getReservedSlotCounts(month);
  return reservationCountsFromSqlite(formId, month);
}

function slotsForDate(schedule, dateKey, date, holidaySet) {
  const override = schedule.overrides.find((item) => item.date === dateKey);
  if (override?.mode === 'blocked') return { slots: [], reason: override.reason || 'blocked' };

  const weekday = date.getDay();
  const weekend = weekday === 0 || weekday === 6;
  const holiday = holidaySet.has(dateKey);
  const holidayMode = HOLIDAY_MODES.has(schedule.settings.holidayMode) ? schedule.settings.holidayMode : 'national_block';

  if (holiday && holidayMode === 'national_block' && !override) return { slots: [], reason: 'holiday' };

  let slots = [];
  if (override?.mode === 'custom_slots') {
    slots = override.slots;
  } else {
    if (holiday && holidayMode === 'custom') {
      slots = schedule.slots.filter((slot) => slot.enabled && slot.dayType === 'holiday');
      if (!slots.length) return { slots: [], reason: 'holiday' };
    }
    if (!slots.length && weekend) {
      slots = schedule.slots.filter((slot) => slot.enabled && slot.dayType === 'weekend');
    }
    if (!slots.length) {
      slots = schedule.slots.filter((slot) => slot.enabled && slot.dayType === 'weekday' && slot.weekday === weekday);
    }
    if (override?.mode === 'extra_slots') slots = slots.concat(override.slots);
  }

  return { slots, reason: slots.length ? null : weekend ? 'weekend' : holiday ? 'holiday' : 'no_slots' };
}

export async function buildFormAvailability(formSlug, month, holidaySet = new Set()) {
  const schedule = getSchedule(formSlug);
  const { year, monthIndex } = parseMonth(month);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const counts = await reservationCounts(schedule.form.id, month);
  const days = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day);
    const dateKey = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    const past = isPast(date);
    const outOfRange = isBeyondLookahead(date, schedule.settings.lookaheadMonths);
    const disabled = !schedule.settings.enabled;
    const resolved = disabled || past || outOfRange
      ? { slots: [], reason: disabled ? 'disabled' : past ? 'past' : 'out_of_range' }
      : slotsForDate(schedule, dateKey, date, holidaySet);

    const slots = resolved.slots.map((slot) => {
      const label = labelForSlot(slot);
      const reserved = counts.get(`${dateKey}|${label}`) || 0;
      const capacity = Number(slot.capacity || 1);
      return {
        time: label,
        label,
        start: slot.startTime,
        end: slot.endTime,
        capacity,
        reserved,
        available: reserved < capacity,
      };
    });

    days.push({
      date: dateKey,
      day,
      weekday: date.getDay(),
      closed: !slots.some((slot) => slot.available),
      closedReason: slots.some((slot) => slot.available) ? null : resolved.reason || 'full',
      slots,
    });
  }

  return {
    month,
    timezone: schedule.settings.timezone,
    holidayMode: schedule.settings.holidayMode,
    slots: [...new Set(days.flatMap((day) => day.slots.map((slot) => slot.label)))],
    days,
  };
}

export async function isFormDateSelectable(formSlug, date, slotLabel, holidaySet = new Set()) {
  const dateKey = normalizeDate(date);
  if (!dateKey) return false;
  const availability = await buildFormAvailability(formSlug, dateKey.slice(0, 7), holidaySet);
  const day = availability.days.find((item) => item.date === dateKey);
  return Boolean(day?.slots.some((slot) => slot.label === slotLabel && slot.available));
}

export async function reservedSlotCountsForMonth(formSlug, month) {
  const schedule = getSchedule(formSlug);
  return reservationCounts(schedule.form.id, month);
}
