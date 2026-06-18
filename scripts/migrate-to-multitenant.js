'use strict';
// Migração única: transforma o banco single-tenant (moura-rsvp.db) no primeiro
// tenant do sistema multi-tenant.
//
// O que faz:
//   1. Copia DATA_DIR/moura-rsvp.db → DATA_DIR/tenants/<slug>/rsvp.db
//   2. Registra a organização em router.db
//   3. Popula event_slugs com todos os slugs existentes
//   4. Popula admin_emails com todos os e-mails existentes
//
// Segurança: o banco original (moura-rsvp.db) NÃO é removido — pode ser usado
// para rollback até o administrador confirmar que a migração está correta.
//
// Uso:
//   node scripts/migrate-to-multitenant.js [--tenant-slug=moura] [--tenant-name="Moura Agência"]
// Ou como função chamada internamente pelo server.js no primeiro boot pós-upgrade:
//   require('./scripts/migrate-to-multitenant')({ tenantSlug, tenantName })

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

function migrate({ tenantSlug, tenantName } = {}) {
  tenantSlug = tenantSlug || process.env.DEFAULT_TENANT_SLUG || 'moura';
  tenantName = tenantName || process.env.DEFAULT_TENANT_NAME || 'Organização';

  const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');

  const oldPath = path.join(DATA_DIR, 'moura-rsvp.db');
  const newDir  = path.join(DATA_DIR, 'tenants', tenantSlug);
  const newPath = path.join(newDir, 'rsvp.db');

  if (!fs.existsSync(oldPath)) {
    console.log(`[migrate] banco legado não encontrado em ${oldPath}`);
    console.log('[migrate] nada a migrar — banco multi-tenant será criado do zero');
    return;
  }

  if (fs.existsSync(newPath)) {
    console.log(`[migrate] banco do tenant já existe em ${newPath}`);
    console.log('[migrate] migração ignorada — apague o arquivo para forçar');
    return;
  }

  // 1. Copia o banco legado para o diretório do tenant.
  fs.mkdirSync(newDir, { recursive: true });
  fs.copyFileSync(oldPath, newPath);
  console.log(`[migrate] banco copiado: ${oldPath} → ${newPath}`);

  // Copia também os arquivos WAL/SHM se existirem (consistência transacional).
  for (const suffix of ['-wal', '-shm']) {
    const src = oldPath + suffix;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, newPath + suffix);
      console.log(`[migrate] copiado: ${path.basename(src)}`);
    }
  }

  // 2. Abre o router.db e registra tudo.
  let routerDb;
  const ROUTER_PATH = path.join(DATA_DIR, 'router.db');
  try {
    const Database = require('better-sqlite3');
    routerDb = new Database(ROUTER_PATH);
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    routerDb = new DatabaseSync(ROUTER_PATH);
  }
  routerDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  routerDb.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS event_slugs (
      slug TEXT PRIMARY KEY,
      tenant_slug TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_emails (
      email TEXT PRIMARY KEY,
      tenant_slug TEXT NOT NULL
    );
  `);

  // Registra a organização (idempotente).
  const orgExists = routerDb.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(tenantSlug);
  if (!orgExists) {
    routerDb.prepare('INSERT INTO organizations (slug, name) VALUES (?, ?)').run(tenantSlug, tenantName);
    console.log(`[migrate] organização registrada: ${tenantSlug} (${tenantName})`);
  }

  // 3. Abre o banco do tenant para ler slugs e e-mails.
  let tenantDb;
  try {
    const Database = require('better-sqlite3');
    tenantDb = new Database(newPath);
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    tenantDb = new DatabaseSync(newPath);
  }
  tenantDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  // 4. Popula event_slugs.
  let slugCount = 0;
  try {
    const slugs = tenantDb.prepare('SELECT slug FROM events').all();
    const insertSlug = routerDb.prepare('INSERT OR REPLACE INTO event_slugs (slug, tenant_slug) VALUES (?, ?)');
    const txn = routerDb.transaction(() => {
      for (const row of slugs) {
        insertSlug.run(row.slug, tenantSlug);
        slugCount++;
      }
    });
    txn();
    console.log(`[migrate] ${slugCount} slug(s) de evento registrado(s)`);
  } catch (e) {
    console.warn('[migrate] aviso ao registrar slugs:', e.message);
  }

  // 5. Popula admin_emails.
  let emailCount = 0;
  try {
    const admins = tenantDb.prepare("SELECT email FROM admins WHERE status = 'ativo' OR status = 'pendente'").all();
    const insertEmail = routerDb.prepare('INSERT OR REPLACE INTO admin_emails (email, tenant_slug) VALUES (?, ?)');
    const txn = routerDb.transaction(() => {
      for (const row of admins) {
        insertEmail.run(String(row.email).toLowerCase().trim(), tenantSlug);
        emailCount++;
      }
    });
    txn();
    console.log(`[migrate] ${emailCount} e-mail(s) de admin registrado(s)`);
  } catch (e) {
    console.warn('[migrate] aviso ao registrar e-mails:', e.message);
  }

  console.log('[migrate] ✓ concluída');
  console.log(`[migrate]   banco original preservado em: ${oldPath}`);
  console.log(`[migrate]   remova-o manualmente após validar o sistema`);
}

// Execução direta via CLI.
if (require.main === module) {
  const args   = process.argv.slice(2);
  const getArg = (key) => {
    const match = args.find((a) => a.startsWith(`--${key}=`));
    return match ? match.split('=').slice(1).join('=') : undefined;
  };
  migrate({
    tenantSlug: getArg('tenant-slug'),
    tenantName: getArg('tenant-name'),
  });
}

module.exports = migrate;
