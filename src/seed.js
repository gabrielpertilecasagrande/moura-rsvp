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
  // Garante que o usuário inicial tenha acesso total e esteja ativo.
  db.prepare("UPDATE admins SET role = 'admin', status = 'ativo' WHERE id = ?").run(exists.id);
  console.log(`Administrador já existe: ${email} (papel garantido como admin/ativo)`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO admins (name, email, password_hash, role, status) VALUES (?,?,?,'admin','ativo')")
    .run(name, email, hash);
  console.log(`Administrador criado:\n  e-mail: ${email}\n  senha:  ${password}`);
}
process.exit(0);
