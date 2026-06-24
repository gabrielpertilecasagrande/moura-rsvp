// Cria o administrador inicial a partir das variáveis do .env.
// Uso: npm run seed
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const name = process.env.ADMIN_NAME || 'Administrador';
const email = (process.env.ADMIN_EMAIL || 'admin@moura.com.br').toLowerCase();

// Gera uma senha forte e aleatória quando ADMIN_PASSWORD não está definido.
// Assim NUNCA usamos uma senha padrão conhecida (ex.: a antiga "moura2026"):
// se ninguém configurou a senha, criamos uma imprevisível e a mostramos UMA vez.
function strongRandomPassword() {
  // ~20 caracteres base64url (sem símbolos ambíguos), bom para anotar e trocar depois.
  return crypto.randomBytes(15).toString('base64').replace(/[+/=]/g, '').slice(0, 20);
}

const envPassword = process.env.ADMIN_PASSWORD;
const password = envPassword || strongRandomPassword();

const exists = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (exists) {
  // Garante que o usuário inicial tenha acesso total e esteja ativo.
  // Nunca alteramos a senha de um admin já existente.
  db.prepare("UPDATE admins SET role = 'admin', status = 'ativo' WHERE id = ?").run(exists.id);
  console.log(`Administrador já existe: ${email} (papel garantido como admin/ativo)`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO admins (name, email, password_hash, role, status) VALUES (?,?,?,'admin','ativo')")
    .run(name, email, hash);
  if (envPassword) {
    console.log(`Administrador criado:\n  e-mail: ${email}\n  senha:  (a definida em ADMIN_PASSWORD)`);
  } else {
    console.log(
      `Administrador criado com SENHA ALEATÓRIA (ADMIN_PASSWORD não estava definido):\n` +
      `  e-mail: ${email}\n  senha:  ${password}\n` +
      `⚠️  Anote esta senha AGORA e troque-a após o primeiro login. ` +
      `Para definir uma senha fixa, configure ADMIN_PASSWORD e rode novamente.`
    );
  }
}
process.exit(0);
