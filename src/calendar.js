import { config } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    throw new Error('month must use YYYY-MM format');
  }

  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month is invalid');

  return { year, monthIndex: monthNumber - 1 };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function isPast(date) {
  return startOfDay(date).getTime() < startOfDay(new Date()).getTime();
}

function isBeyondLookahead(date) {
  const limit = new Date();
  limit.setMonth(limit.getMonth() + config.lookaheadMonths);
  return startOfDay(date).getTime() > startOfDay(limit).getTime();
}

function isHoliday(date, holidays = config.holidays) {
  return holidays.has(toDateKey(date));
}

export function buildMonthAvailability(month, reservedByDate = new Map(), holidays = config.holidays) {
  const { year, monthIndex } = parseMonth(month);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const days = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day);
    const dateKey = toDateKey(date);
    const reservedSlots = reservedByDate.get(dateKey) || new Set();
    const holiday = isHoliday(date, holidays);
    const closed = isPast(date) || isWeekend(date) || holiday || isBeyondLookahead(date);
    const slots = config.availableSlots.map((slot) => ({
      time: slot,
      available: !closed && !reservedSlots.has(slot),
    }));

    days.push({
      date: dateKey,
      day,
      weekday: date.getDay(),
      closed,
      closedReason: closed
        ? isPast(date)
          ? 'past'
          : isWeekend(date)
            ? 'weekend'
            : holiday
              ? 'holiday'
              : 'out_of_range'
        : null,
      slots,
    });
  }

  return {
    month,
    slots: config.availableSlots,
    days,
  };
}

export function currentMonthKey() {
  return toDateKey(new Date()).slice(0, 7);
}

export function normalizeDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (toDateKey(parsed) !== date) return null;
  return date;
}

export function normalizeMonthFromDate(date) {
  return date.slice(0, 7);
}

export function isDateSelectable(date, reservedByDate, slot, holidays = config.holidays) {
  const dateKey = normalizeDate(date);
  if (!dateKey) return false;
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (isPast(parsed) || isWeekend(parsed) || isHoliday(parsed, holidays) || isBeyondLookahead(parsed)) return false;
  const reservedSlots = reservedByDate.get(dateKey) || new Set();
  return !reservedSlots.has(slot);
}
