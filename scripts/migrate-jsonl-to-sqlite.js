import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { decryptRecord, readQuoteBackups } from '../src/backups.js';
import { createSubmission } from '../src/forms.js';
import { getDb } from '../src/db.js';

async function readStatusEvents() {
  try {
    const raw = await readFile(config.statusEventsFile, 'utf8');
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
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const db = getDb();
const existing = db.prepare('SELECT id FROM submissions WHERE id = ?');
const eventsExisting = db.prepare('SELECT count(*) AS count FROM submission_events WHERE submission_id = ? AND status = ? AND created_at = ?');
const insertEvent = db.prepare(`
  INSERT INTO submission_events (submission_id, status, note, created_at)
  VALUES (?, ?, ?, ?)
`);
const updateStatus = db.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?');

const records = await readQuoteBackups();
let inserted = 0;

for (const record of records) {
  if (!record.id || !record.quote) continue;
  if (existing.get(record.id)) continue;
  createSubmission('cotizacion', record.quote, {
    requestId: record.id,
    createdAt: record.created_at,
    source: record.meta?.source || '',
    userAgent: record.meta?.user_agent || '',
  });
  inserted += 1;
}

const events = await readStatusEvents();
let eventCount = 0;

for (const event of events) {
  if (!event.quote_id || !event.status || !event.changed_at) continue;
  if (!existing.get(event.quote_id)) continue;
  if (eventsExisting.get(event.quote_id, event.status, event.changed_at).count) continue;
  insertEvent.run(event.quote_id, event.status, event.note || '', event.changed_at);
  updateStatus.run(event.status, event.changed_at, event.quote_id);
  eventCount += 1;
}

console.log(`migrated submissions: ${inserted}`);
console.log(`migrated status events: ${eventCount}`);
