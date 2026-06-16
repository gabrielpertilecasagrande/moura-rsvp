// Garante que sempre exista um administrador ativo, criado a partir das
// variáveis de ambiente (ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME).
// É idempotente: roda em toda inicialização do servidor sem duplicar contas.
// Assim o login funciona mesmo após um deploy, sem rodar "npm run seed" à mão.
const bcrypt = require('bcryptjs');
const db = require('../db');

function ensureAdmin() {
  const name     = process.env.ADMIN_NAME     || 'Admin';
  const email    = (process.env.ADMIN_EMAIL   || 'admin@moura.com.br').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'moura2026';

  const existing = db.prepare('SELECT id, role, status FROM admins WHERE email = ?').get(email);
  if (existing) {
    // Garante que a conta-mestre continue como admin ativo.
    if (existing.role !== 'admin' || existing.status !== 'ativo') {
      db.prepare("UPDATE admins SET role = 'admin', status = 'ativo' WHERE id = ?").run(existing.id);
    }
    return { created: false, email };
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'ativo')"
  ).run(name, email, hash);
  return { created: true, email };
}

module.exports = { ensureAdmin };
