import { createAdminUser } from '../src/admin-users.js';

function arg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

const username = arg('username') || process.env.ADMIN_CREATE_USERNAME || process.env.ADMIN_USER || '';
const email = arg('email') || process.env.ADMIN_CREATE_EMAIL || process.env.ADMIN_EMAIL || '';
const password = arg('password') || process.env.ADMIN_CREATE_PASSWORD || process.env.ADMIN_PASSWORD || '';
const name = arg('name') || process.env.ADMIN_CREATE_NAME || '';

try {
  const user = createAdminUser({ username, email, password, name });
  console.log(JSON.stringify({ ok: true, user }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
}
