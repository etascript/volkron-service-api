import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

export function getFormBySlug(slug) {
  return getDb().prepare('SELECT * FROM forms WHERE slug = ? AND status = ?').get(slug, 'active');
}

export function getFormStatuses(formSlug) {
  const database = getDb();
  const form = getFormBySlug(formSlug);
  if (!form) return [];
  return database.prepare(`
    SELECT value, label, is_default AS isDefault, sort_order AS sortOrder
    FROM form_statuses
    WHERE form_id = ?
    ORDER BY sort_order ASC, label ASC
  `).all(form.id).map((status) => ({
    ...status,
    isDefault: Boolean(status.isDefault),
  }));
}

export function getDefaultStatus(formSlug) {
  const statuses = getFormStatuses(formSlug);
  return statuses.find((status) => status.isDefault)?.value || statuses[0]?.value || 'pending';
}

export function createSubmission(formSlug, values, meta = {}) {
  const database = getDb();
  const form = getFormBySlug(formSlug);
  if (!form) throw new Error(`Form not found: ${formSlug}`);

  const id = meta.requestId || randomUUID();
  const createdAt = meta.createdAt || new Date().toISOString();
  const defaultStatus = getDefaultStatus(formSlug);
  const fields = database.prepare('SELECT id, name FROM form_fields WHERE form_id = ?').all(form.id);
  const fieldByName = new Map(fields.map((field) => [field.name, field]));

  const insertSubmission = database.prepare(`
    INSERT INTO submissions (id, form_id, status, source, user_agent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertValue = database.prepare(`
    INSERT INTO submission_values (submission_id, field_id, field_name, value)
    VALUES (?, ?, ?, ?)
  `);
  const insertEvent = database.prepare(`
    INSERT INTO submission_events (submission_id, status, note, created_at)
    VALUES (?, ?, ?, ?)
  `);

  database.transaction(() => {
    insertSubmission.run(id, form.id, defaultStatus, meta.source || '', meta.userAgent || '', createdAt, createdAt);
    Object.entries(values).forEach(([name, value]) => {
      if (name === 'website') return;
      const field = fieldByName.get(name);
      insertValue.run(id, field?.id || null, name, value == null ? '' : String(value));
    });
    insertEvent.run(id, defaultStatus, '', createdAt);
  })();

  return id;
}

function rowsToSubmission(rowGroup) {
  const first = rowGroup[0];
  const quote = {};
  rowGroup.forEach((row) => {
    quote[row.field_name] = row.value || '';
  });

  const history = JSON.parse(first.history_json || '[]');
  const lastEvent = history[history.length - 1];

  return {
    id: first.id,
    created_at: first.created_at,
    status: first.status,
    status_note: lastEvent?.note || '',
    status_changed_at: lastEvent?.changed_at || '',
    status_history: history,
    quote,
    meta: {
      source: first.source || '',
      user_agent: first.user_agent || '',
    },
  };
}

function quoteSearchText(item) {
  const quote = item.quote || {};
  return [
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
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

export function listSubmissions(formSlug, query = {}) {
  const database = getDb();
  const rows = database.prepare(`
    SELECT
      s.id,
      s.status,
      s.source,
      s.user_agent,
      s.created_at,
      sv.field_name,
      sv.value,
      (
        SELECT json_group_array(json_object(
          'status', se.status,
          'note', coalesce(se.note, ''),
          'changed_at', se.created_at,
          'type', CASE WHEN se.id = (
            SELECT min(se2.id) FROM submission_events se2 WHERE se2.submission_id = s.id
          ) THEN 'created' ELSE 'status' END
        ))
        FROM submission_events se
        WHERE se.submission_id = s.id
        ORDER BY se.created_at ASC
      ) AS history_json
    FROM submissions s
    JOIN forms f ON f.id = s.form_id
    LEFT JOIN submission_values sv ON sv.submission_id = s.id
    WHERE f.slug = ?
    ORDER BY s.created_at DESC
  `).all(formSlug);

  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(row);
  });

  const items = [...groups.values()].map(rowsToSubmission);
  const filtered = applyFilters(items, query);
  const limit = Math.min(Math.max(Number(query.limit || 200), 1), 1000);
  const offset = Math.max(Number(query.offset || 0), 0);

  return {
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
    filters: {
      statuses: getFormStatuses(formSlug),
      regions: uniqueOptions(items, 'region'),
      comunas: uniqueOptions(items, 'comuna'),
      services: uniqueOptions(items, 'tipo_servicio'),
    },
  };
}

export function appendSubmissionStatus(submissionId, payload) {
  const database = getDb();
  const exists = database.prepare(`
    SELECT s.id, f.slug AS form_slug
    FROM submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = ?
  `).get(submissionId);
  if (!exists) {
    return { ok: false, status: 404, body: { ok: false, message: 'Cotizacion no encontrada' } };
  }
  const allowed = new Set(getFormStatuses(exists.form_slug).map((status) => status.value));
  if (!allowed.has(payload.status)) {
    return { ok: false, status: 400, body: { ok: false, message: 'Estado invalido' } };
  }

  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?').run(payload.status, now, submissionId);
    database.prepare(`
      INSERT INTO submission_events (submission_id, status, note, created_at)
      VALUES (?, ?, ?, ?)
    `).run(submissionId, payload.status, payload.note || '', now);
  })();

  return { ok: true, status: 201, body: { ok: true, event: { quote_id: submissionId, status: payload.status, note: payload.note || '', changed_at: now } } };
}

export function updateFormStatuses(formSlug, statuses, defaultStatus) {
  const database = getDb();
  const form = getFormBySlug(formSlug);
  if (!form) throw new Error(`Form not found: ${formSlug}`);

  const normalized = statuses
    .map((status, index) => ({
      value: String(status.value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, ''),
      label: String(status.label || '').trim(),
      sortOrder: Number(status.sortOrder || (index + 1) * 10),
    }))
    .filter((status) => status.value && status.label);

  if (!normalized.length) throw new Error('At least one status is required');

  const selectedDefault = normalized.some((status) => status.value === defaultStatus)
    ? defaultStatus
    : normalized[0].value;
  const now = new Date().toISOString();

  database.transaction(() => {
    database.prepare('DELETE FROM form_statuses WHERE form_id = ?').run(form.id);
    const insertStatus = database.prepare(`
      INSERT INTO form_statuses
        (id, form_id, value, label, is_default, sort_order, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((status) => {
      insertStatus.run(
        `status_${form.slug}_${status.value}`,
        form.id,
        status.value,
        status.label,
        status.value === selectedDefault ? 1 : 0,
        status.sortOrder,
        now,
        now,
      );
    });
  })();

  return getFormStatuses(formSlug);
}
