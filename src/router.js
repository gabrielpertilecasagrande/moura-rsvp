'use strict';
// Banco de roteamento global (router.db):
// mapeia organizações, slugs de eventos e e-mails de admin para o tenant correto.
// NÃO contém dados de eventos ou participantes — apenas o índice de roteamento.
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ROUTER_PATH = path.join(DATA_DIR, 'router.db');

let routerDb;
try {
  const Database = require('better-sqlite3');
  routerDb = new Database(ROUTER_PATH);
  console.log(`[router] better-sqlite3 em ${ROUTER_PATH}`);
} catch {
  const { DatabaseSync } = require('node:sqlite');
  routerDb = new DatabaseSync(ROUTER_PATH);
  console.log(`[router] node:sqlite em ${ROUTER_PATH}`);
}

routerDb.exec('PRAGMA journal_mode = WAL;');
routerDb.exec('PRAGMA foreign_keys = ON;');

routerDb.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT    NOT NULL UNIQUE,
    name       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Índice global de slugs de eventos: garante unicidade entre tenants
  -- e permite encontrar o banco correto a partir do slug público.
  CREATE TABLE IF NOT EXISTS event_slugs (
    slug        TEXT PRIMARY KEY,
    tenant_slug TEXT NOT NULL
  );

  -- Índice global de e-mails de admin: permite o login sem saber o tenant.
  CREATE TABLE IF NOT EXISTS admin_emails (
    email       TEXT PRIMARY KEY,
    tenant_slug TEXT NOT NULL
  );

  -- Login persistente (PWA/app): refresh tokens opacos (só o hash). Ficam no
  -- índice global junto do tenant de cada sessão, para a renovação encontrar o
  -- banco certo sem o tenant aparecer no token. Expiração ROLANTE (ver sessions.js).
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    tenant_slug  TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    user_agent   TEXT,
    expires_at   TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(tenant_slug, user_id);
`);

// ── Organizações ──────────────────────────────────────────────────────────────

function organizationExists(slug) {
  return !!routerDb.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug);
}

function createOrganization(slug, name) {
  routerDb.prepare('INSERT INTO organizations (slug, name) VALUES (?, ?)').run(slug, name);
}

function listOrganizations() {
  return routerDb.prepare('SELECT * FROM organizations ORDER BY created_at').all();
}

// ── Slugs de eventos ──────────────────────────────────────────────────────────

function findTenantBySlug(slug) {
  return routerDb.prepare('SELECT tenant_slug FROM event_slugs WHERE slug = ?').get(slug);
}

function registerEventSlug(slug, tenantSlug) {
  routerDb.prepare('INSERT OR REPLACE INTO event_slugs (slug, tenant_slug) VALUES (?, ?)').run(slug, tenantSlug);
}

function unregisterEventSlug(slug) {
  routerDb.prepare('DELETE FROM event_slugs WHERE slug = ?').run(slug);
}

// ── E-mails de admin ──────────────────────────────────────────────────────────

function findTenantByEmail(email) {
  return routerDb.prepare('SELECT tenant_slug FROM admin_emails WHERE email = ?').get(
    String(email || '').toLowerCase().trim()
  );
}

function registerAdminEmail(email, tenantSlug) {
  routerDb.prepare('INSERT OR REPLACE INTO admin_emails (email, tenant_slug) VALUES (?, ?)').run(
    String(email).toLowerCase().trim(), tenantSlug
  );
}

function unregisterAdminEmail(email) {
  routerDb.prepare('DELETE FROM admin_emails WHERE email = ?').run(
    String(email).toLowerCase().trim()
  );
}

function updateAdminEmail(oldEmail, newEmail, tenantSlug) {
  const txn = routerDb.transaction(() => {
    routerDb.prepare('DELETE FROM admin_emails WHERE email = ?').run(
      String(oldEmail).toLowerCase().trim()
    );
    routerDb.prepare('INSERT OR REPLACE INTO admin_emails (email, tenant_slug) VALUES (?, ?)').run(
      String(newEmail).toLowerCase().trim(), tenantSlug
    );
  });
  txn();
}

module.exports = {
  routerDb,
  organizationExists,
  createOrganization,
  listOrganizations,
  findTenantBySlug,
  registerEventSlug,
  unregisterEventSlug,
  findTenantByEmail,
  registerAdminEmail,
  unregisterAdminEmail,
  updateAdminEmail,
};
