// Cria o administrador inicial a partir das variáveis do .env.
// Uso: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const name = process.env.ADMIN_NAME || 'Administrador';
const email = (process.env.ADMIN_EMAIL || 'admin@moura.com.br').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'moura2026';

const exists = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (exists) {
  console.log(`Administrador já existe: ${email}`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (name, email, password_hash) VALUES (?,?,?)').run(name, email, hash);
  console.log(`Administrador criado:\n  e-mail: ${email}\n  senha:  ${password}`);
}
process.exit(0);
