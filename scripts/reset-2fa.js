#!/usr/bin/env node
// Desliga a verificação em duas etapas (2FA) de uma conta — escape hatch para
// quando alguém perde o app autenticador E os códigos de recuperação.
// Multi-tenant: informe o slug da organização (padrão: o tenant padrão).
// Uso:  node scripts/reset-2fa.js <email> [slug-da-organizacao]
'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const email = (process.argv[2] || '').toLowerCase().trim();
const slug = (process.argv[3] || process.env.DEFAULT_TENANT_SLUG || 'moura').toLowerCase().trim();
if (!email) {
  console.error('Uso: node scripts/reset-2fa.js <email> [slug-da-organizacao]');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const dbPath = path.join(DATA_DIR, 'tenants', slug, 'rsvp.db');
if (!fs.existsSync(dbPath)) {
  console.error(`Banco do tenant "${slug}" não encontrado em: ${dbPath}`);
  console.error('Confira o slug da organização (2º argumento).');
  process.exit(1);
}

const db = new Database(dbPath);
const admin = db.prepare('SELECT id, name, email, totp_enabled FROM admins WHERE email = ?').get(email);
if (!admin) { console.error(`Nenhuma conta com o e-mail "${email}" na organização "${slug}".`); process.exit(1); }

db.prepare("UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_recovery_codes = NULL, totp_enrolled_at = NULL WHERE id = ?").run(admin.id);
db.close();
console.log(`✅ Verificação em duas etapas desativada para ${admin.name || admin.email} (org: ${slug}). A pessoa volta a entrar só com a senha e pode reativar o 2FA na tela "Minha conta".`);
