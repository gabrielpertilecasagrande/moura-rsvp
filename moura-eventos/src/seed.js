require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db     = require('./db');

const name     = process.env.ADMIN_NAME     || 'Admin';
const email    = process.env.ADMIN_EMAIL    || 'admin@moura.com.br';
const password = process.env.ADMIN_PASSWORD || 'moura2026';

const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (existing) {
  console.log(`Admin já existe: ${email}`);
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 10);
db.prepare(
  'INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)'
).run(name, email, hash, 'admin', 'ativo');

console.log(`Admin criado: ${email} / ${password}`);
