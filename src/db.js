'use strict';
// Camada de banco relacional (SQLite) — multi-tenant via banco-por-tenant.
//
// Cada organizador tem seu próprio arquivo SQLite em:
//   DATA_DIR/tenants/<slug>/rsvp.db
//
// O objeto exportado é um Proxy que despacha db.prepare() / db.exec() / etc.
// para o banco do tenant da requisição atual, identificado via AsyncLocalStorage.
//
// Uso em middlewares / rotas:
//   const db = require('../db');            // proxy — usa ALS internamente
//   const { openTenantDb, runWithDb } = require('../db');  // acesso direto
//
// Para definir o contexto de tenant (chamado pelo middleware de auth):
//   runWithDb('moura', () => next());
//
// Benefícios: todos os arquivos de rotas existentes usam `const db = require('../db')`
// sem alteração — o proxy torna a troca de banco transparente.

const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('path');
const fs   = require('fs');

const als = new AsyncLocalStorage();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

// Cache de conexões abertas: uma instância por tenant slug.
const dbCache = new Map();

// Migrações idempotentes de schema (adiciona colunas sem apagar dados existentes).
function applyMigrations(db) {
  function columnExists(table, col) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  }
  function addColumn(table, col, def) {
    if (!columnExists(table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      console.log(`[db] migração: ${table}.${col} adicionada`);
    }
  }

  addColumn('admins', 'role',   "TEXT NOT NULL DEFAULT 'editor'");
  addColumn('admins', 'status', "TEXT NOT NULL DEFAULT 'ativo'");
  addColumn('admins', 'last_login', 'TEXT');
  // "Sair de todos os outros aparelhos": JWTs de acesso emitidos ANTES deste
  // instante (epoch em segundos) são recusados na hora pelo requireAuth.
  addColumn('admins', 'sessions_invalidated_at', 'INTEGER');
  addColumn('events', 'whatsapp', 'TEXT');
  addColumn('events', 'force_open', 'INTEGER DEFAULT 0');
  addColumn('events', 'whatsapp_enabled', 'INTEGER DEFAULT 1');
  addColumn('events', 'city', 'TEXT');
  addColumn('events', 'address', 'TEXT');
  addColumn('audit_log', 'actor', 'TEXT');
  addColumn('participants', 'extra', 'TEXT');
  addColumn('participants', 'notes', 'TEXT');
  // LGPD — registro de consentimento do participante (no ato da inscrição).
  addColumn('participants', 'accepted_terms', 'INTEGER DEFAULT 0');
  addColumn('participants', 'accepted_privacy_policy', 'INTEGER DEFAULT 0');
  addColumn('participants', 'accepted_data_processing', 'INTEGER DEFAULT 0');
  addColumn('participants', 'consent_date', 'TEXT');
  addColumn('participants', 'consent_ip', 'TEXT');
  addColumn('participants', 'terms_version', 'TEXT');
  addColumn('participants', 'privacy_version', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS data_erasures (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no   TEXT NOT NULL,
      subject_name  TEXT,
      subject_email TEXT,
      reason       TEXT,
      summary      TEXT,
      item_count   INTEGER NOT NULL DEFAULT 0,
      performed_by TEXT,
      performed_ip TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_sessions (
      ref        TEXT PRIMARY KEY,
      token      TEXT NOT NULL,
      event_id   TEXT,
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS event_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      can_view         INTEGER NOT NULL DEFAULT 1,
      can_edit         INTEGER NOT NULL DEFAULT 0,
      can_participants INTEGER NOT NULL DEFAULT 0,
      can_export       INTEGER NOT NULL DEFAULT 0,
      can_history      INTEGER NOT NULL DEFAULT 0,
      can_messages     INTEGER NOT NULL DEFAULT 0,
      can_duplicate    INTEGER NOT NULL DEFAULT 0,
      can_delete       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, event_id)
    );
  `);

  // Refresh token entregue junto do JWT de sessão no SSO (login persistente do app).
  addColumn('sso_sessions', 'refresh_token', 'TEXT');

  // Normaliza papéis legados.
  try { db.exec("UPDATE admins SET role = 'gestor' WHERE role = 'editor'"); } catch { /* sem ação */ }

  // Se só há um admin no banco, garante que ele é admin/ativo (proteção pós-migração).
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
    if (total === 1) db.exec("UPDATE admins SET role = 'admin', status = 'ativo'");
  } catch { /* banco ainda vazio */ }
}

// Formato válido de slug de tenant: minúsculas, números e hífen (1–40).
// Impede travessia de caminho (ex.: "../../etc") e nomes de pasta inesperados.
const VALID_TENANT_SLUG = /^[a-z0-9-]{1,40}$/;

// Abre (ou retorna do cache) o banco SQLite do tenant.
function openTenantDb(tenantSlug) {
  if (!tenantSlug || !VALID_TENANT_SLUG.test(tenantSlug)) {
    throw new Error(`[tenant] slug inválido: "${String(tenantSlug)}"`);
  }
  if (dbCache.has(tenantSlug)) return dbCache.get(tenantSlug);

  const dir = path.join(DATA_DIR, 'tenants', tenantSlug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'rsvp.db');

  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
    console.log(`[db] ${tenantSlug}: better-sqlite3 em ${dbPath}`);
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
    console.log(`[db] ${tenantSlug}: node:sqlite em ${dbPath}`);
  }

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  applyMigrations(db);

  dbCache.set(tenantSlug, db);
  return db;
}

// Executa fn() com o banco do tenant no contexto da AsyncLocalStorage.
// Tudo que chamar db.prepare() / db.exec() dentro de fn() usará esse banco.
function runWithDb(tenantSlug, fn) {
  return als.run(openTenantDb(tenantSlug), fn);
}

// Proxy: intercepta db.xxx para despachar ao banco do tenant atual (via ALS).
// Propriedades nomeadas (openTenantDb, runWithDb) são retornadas diretamente,
// sem passar pelo ALS — permitem acesso direto de scripts e código de startup.
const NAMED = { openTenantDb, runWithDb };

const proxy = new Proxy({}, {
  get(_, prop) {
    if (Object.prototype.hasOwnProperty.call(NAMED, prop)) return NAMED[prop];
    const db = als.getStore();
    if (!db) {
      throw new Error(
        `[tenant] Sem contexto de banco (prop: "${String(prop)}"). ` +
        'Certifique-se de que o middleware de autenticação está montado antes desta rota.'
      );
    }
    const val = db[prop];
    return typeof val === 'function' ? val.bind(db) : val;
  },
});

module.exports = proxy;
