import { z } from 'zod';
import {
  appendSubmissionStatus,
  createSubmission,
  getFormStatuses,
  listSubmissions,
  softDeleteSubmission,
  updateFormStatuses,
} from './forms.js';
import { quoteSchema } from './validation.js';

const statusSchema = z.object({
  status: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional().default(''),
});

const settingsSchema = z.object({
  statuses: z.array(z.object({
    value: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    sortOrder: z.number().optional(),
  })).min(1),
  defaultStatus: z.string().trim().min(1).max(80),
});

function countBy(items, getter) {
  const counts = new Map();
  items.forEach((item) => {
    const key = getter(item) || 'Sin dato';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'es'));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export async function listQuotes(query = {}) {
  return listSubmissions('cotizacion', query);
}

export async function getStats() {
  const quotes = await listQuotes({ limit: 1000 });
  const items = quotes.items;
  const statusLabels = new Map((quotes.filters.statuses || []).map((status) => [status.value, status.label]));
  const now = new Date();
  const today = dateKey(now);
  const currentMonth = monthKey(now);
  const inactiveStatuses = new Set(['lost', 'cancelled', 'canceled', 'rechazada', 'reprobado']);
  const won = items.filter((item) => item.status === 'won').length;
  const lost = items.filter((item) => item.status === 'lost').length;
  const decided = won + lost;
  const firstContactDeltas = [];

  items.forEach((item) => {
    const contactEvent = (item.status_history || []).find((event) =>
      ['contacted', 'quoted', 'scheduled', 'won', 'lost'].includes(event.status),
    );
    if (!contactEvent || !item.created_at || !contactEvent.changed_at) return;
    const created = new Date(item.created_at);
    const contacted = new Date(contactEvent.changed_at);
    if (Number.isNaN(created.getTime()) || Number.isNaN(contacted.getTime())) return;
    const deltaHours = (contacted.getTime() - created.getTime()) / 36e5;
    if (deltaHours >= 0) firstContactDeltas.push(deltaHours);
  });

  const daily = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = dateKey(addDays(now, -i));
    daily.push({
      label: day,
      value: items.filter((item) => String(item.created_at || '').startsWith(day)).length,
    });
  }

  const monthly = [];
  const monthStart = startOfMonth(now);
  for (let i = 5; i >= 0; i -= 1) {
    const month = monthKey(addMonths(monthStart, -i));
    monthly.push({
      label: month,
      value: items.filter((item) => String(item.created_at || '').startsWith(month)).length,
    });
  }

  return {
    totals: {
      all: items.length,
      currentMonth: items.filter((item) => String(item.created_at || '').startsWith(currentMonth)).length,
      active: items.filter((item) => !inactiveStatuses.has(item.status)).length,
      upcomingVisits: items.filter((item) => {
        const visitDate = item.quote?.fecha_visita || '';
        return visitDate >= today && !inactiveStatuses.has(item.status);
      }).length,
      won,
      lost,
      conversionRate: decided ? Math.round((won / decided) * 100) : 0,
      avgFirstContactHours: firstContactDeltas.length
        ? Math.round(firstContactDeltas.reduce((sum, value) => sum + value, 0) / firstContactDeltas.length)
        : null,
    },
    distributions: {
      status: countBy(items, (item) => statusLabels.get(item.status) || item.status),
      service: countBy(items, (item) => item.quote?.tipo_servicio).slice(0, 8),
      region: countBy(items, (item) => item.quote?.region).slice(0, 8),
      comuna: countBy(items, (item) => item.quote?.comuna).slice(0, 8),
    },
    series: { daily, monthly },
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
    if (['cancelled', 'canceled', 'rechazada', 'cancelada', 'lost', 'reprobado'].includes(status)) return;

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

  return appendSubmissionStatus(quoteId, parsed.data);
}

export async function createManualQuote(payload) {
  const parsed = quoteSchema.omit({ website: true }).safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: 'Datos invalidos',
        issues: parsed.error.issues,
      },
    };
  }

  const id = createSubmission('cotizacion', parsed.data, {
    source: 'admin',
    userAgent: 'admin-panel',
  });

  return { ok: true, status: 201, body: { ok: true, id } };
}

export async function deleteQuote(quoteId, payload) {
  return softDeleteSubmission(quoteId, payload);
}

export async function getSettings() {
  const statuses = getFormStatuses('cotizacion');
  return {
    formsBuilderEnabled: false,
    statuses,
    defaultStatus: statuses.find((status) => status.isDefault)?.value || statuses[0]?.value || '',
  };
}

export async function updateSettings(payload) {
  const parsed = settingsSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: 'Configuracion invalida',
        issues: parsed.error.issues,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      statuses: updateFormStatuses('cotizacion', parsed.data.statuses, parsed.data.defaultStatus),
    },
  };
}
