import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db;

const quoteFields = [
  ['nombre', 'Nombre completo', 'text', 1, null, 10],
  ['rut', 'RUT', 'text', 1, null, 20],
  ['telefono', 'Telefono', 'tel', 1, null, 30],
  ['email', 'Email', 'email', 1, null, 40],
  ['region', 'Region', 'select', 1, null, 50],
  ['comuna', 'Comuna', 'text', 1, null, 60],
  ['tipo_servicio', 'Servicio', 'select', 1, null, 70],
  ['servicio_origen', 'Origen', 'text', 0, null, 80],
  ['fecha_visita', 'Fecha visita', 'date', 0, null, 90],
  ['horario', 'Horario', 'text', 0, null, 100],
  ['detalle', 'Detalle', 'textarea', 0, null, 110],
];

const quoteStatuses = [
  ['pending', 'Pendiente', 1, 10],
  ['contacted', 'Contactado', 0, 20],
  ['quoted', 'Cotizada', 0, 30],
  ['scheduled', 'Agendada', 0, 40],
  ['won', 'Ganada', 0, 50],
  ['lost', 'Perdida', 0, 60],
  ['cancelled', 'Cancelada', 0, 70],
];

export function getDb() {
  if (db) return db;

  mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedQuoteForm(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS form_fields (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      options_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(form_id, name)
    );

    CREATE TABLE IF NOT EXISTS form_statuses (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      label TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(form_id, value)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms(id),
      status TEXT NOT NULL DEFAULT 'received',
      source TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_note TEXT
    );

    CREATE TABLE IF NOT EXISTS submission_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      field_id TEXT REFERENCES form_fields(id),
      field_name TEXT NOT NULL,
      value TEXT,
      UNIQUE(submission_id, field_name)
    );

    CREATE TABLE IF NOT EXISTS submission_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_form_created ON submissions(form_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submission_values_field ON submission_values(field_name, value);
    CREATE INDEX IF NOT EXISTS idx_submission_events_submission ON submission_events(submission_id, created_at);
  `);

  const submissionColumns = database.prepare('PRAGMA table_info(submissions)').all().map((column) => column.name);
  if (!submissionColumns.includes('deleted_at')) {
    database.exec('ALTER TABLE submissions ADD COLUMN deleted_at TEXT');
  }
  if (!submissionColumns.includes('deleted_note')) {
    database.exec('ALTER TABLE submissions ADD COLUMN deleted_note TEXT');
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_submissions_deleted ON submissions(deleted_at)');
}

function seedQuoteForm(database) {
  const now = new Date().toISOString();
  const existing = database.prepare('SELECT id FROM forms WHERE slug = ?').get('cotizacion');
  const formId = existing?.id || 'form_cotizacion';

  if (!existing) {
    database.prepare(`
      INSERT INTO forms (id, name, slug, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(formId, 'Cotizacion de servicio', 'cotizacion', 'active', now, now);
  }

  const insertField = database.prepare(`
    INSERT OR IGNORE INTO form_fields
      (id, form_id, name, label, type, required, options_json, sort_order, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  quoteFields.forEach(([name, label, type, required, options, sortOrder]) => {
    insertField.run(`field_cotizacion_${name}`, formId, name, label, type, required, options, sortOrder, now);
  });

  const hasStatuses = database.prepare('SELECT count(*) AS count FROM form_statuses WHERE form_id = ?').get(formId);
  if (hasStatuses.count === 0) {
    const insertStatus = database.prepare(`
      INSERT INTO form_statuses
        (id, form_id, value, label, is_default, sort_order, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    quoteStatuses.forEach(([value, label, isDefault, sortOrder]) => {
      insertStatus.run(`status_cotizacion_${value}`, formId, value, label, isDefault, sortOrder, now, now);
    });
  }
}
