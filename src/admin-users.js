import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { getDb } from './db.js';

const RESET_TTL_MS = 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function tokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createAdminUser({ username, email, password, name = '' }) {
  const database = getDb();
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();

  if (!cleanUsername || cleanUsername.length < 3) throw new Error('Username must contain at least 3 characters');
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('A valid email is required');
  if (!password || String(password).length < 10) throw new Error('Password must contain at least 10 characters');

  const id = randomUUID();
  const createdAt = nowIso();
  database.prepare(`
    INSERT INTO admin_users
      (id, username, email, name, password_hash, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, cleanUsername, cleanEmail, cleanName, hashPassword(password), 'active', createdAt, createdAt);

  return { id, username: cleanUsername, email: cleanEmail, name: cleanName };
}

export function findAdminUserForLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  if (!value) return null;
  return getDb().prepare(`
    SELECT id, username, email, name, password_hash, status
    FROM admin_users
    WHERE status = 'active'
      AND (username = ? OR email = ?)
  `).get(value, value) || null;
}

export function authenticateAdminUser(login, password) {
  const user = findAdminUserForLogin(login);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name || '',
  };
}

export function createPasswordReset(email) {
  const database = getDb();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = database.prepare(`
    SELECT id, username, email, name
    FROM admin_users
    WHERE email = ? AND status = 'active'
  `).get(cleanEmail);

  if (!user) return null;

  const token = randomBytes(32).toString('base64url');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  database.prepare(`
    INSERT INTO password_reset_tokens
      (id, user_id, token_hash, expires_at, used_at, created_at)
    VALUES
      (?, ?, ?, ?, NULL, ?)
  `).run(randomUUID(), user.id, tokenHash(token), expiresAt, createdAt);

  return { token, expiresAt, user };
}

export function getValidPasswordReset(token) {
  const hash = tokenHash(token);
  return getDb().prepare(`
    SELECT
      prt.id,
      prt.user_id AS userId,
      prt.expires_at AS expiresAt,
      au.email,
      au.username,
      au.name
    FROM password_reset_tokens prt
    JOIN admin_users au ON au.id = prt.user_id
    WHERE prt.token_hash = ?
      AND prt.used_at IS NULL
      AND prt.expires_at > ?
      AND au.status = 'active'
  `).get(hash, nowIso()) || null;
}

export function resetPasswordWithToken(token, password) {
  if (!password || String(password).length < 10) {
    return { ok: false, status: 400, body: { ok: false, message: 'La clave debe tener al menos 10 caracteres.' } };
  }

  const database = getDb();
  const reset = getValidPasswordReset(token);
  if (!reset) {
    return { ok: false, status: 400, body: { ok: false, message: 'El enlace no es valido o ya expiro.' } };
  }

  const changedAt = nowIso();
  database.transaction(() => {
    database.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(password), changedAt, reset.userId);
    database.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
      .run(changedAt, reset.id);
  })();

  return { ok: true, status: 200, body: { ok: true } };
}
