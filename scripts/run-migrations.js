'use strict';
// Runner de migrações multi-tenant.
//
// Itera todos os bancos em DATA_DIR/tenants/*/rsvp.db e aplica o schema +
// migrações de coluna idempotentes (as mesmas executadas pelo db.js no startup).
// Útil ao fazer deploy de uma versão que adiciona colunas ao schema.
//
// Uso:
//   node scripts/run-migrations.js

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const DATA_DIR    = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'schema.sql');

if (!fs.existsSync(TENANTS_DIR)) {
  console.log('[run-migrations] diretório de tenants não encontrado:', TENANTS_DIR);
  process.exit(0);
}

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

function applyMigrations(db) {
  function columnExists(table, col) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  }
  function addColumn(table, col, def) {
    if (!columnExists(table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      return true;
    }
    return false;
  }

  const changed = [];
  if (addColumn('admins', 'role',   "TEXT NOT NULL DEFAULT 'editor'")) changed.push('admins.role');
  if (addColumn('admins', 'status', "TEXT NOT NULL DEFAULT 'ativo'"))  changed.push('admins.status');
  if (addColumn('admins', 'last_login', 'TEXT'))                       changed.push('admins.last_login');
  if (addColumn('events', 'whatsapp', 'TEXT'))                         changed.push('events.whatsapp');
  if (addColumn('events', 'force_open', 'INTEGER DEFAULT 0'))          changed.push('events.force_open');
  if (addColumn('events', 'whatsapp_enabled', 'INTEGER DEFAULT 1'))    changed.push('events.whatsapp_enabled');
  if (addColumn('events', 'city', 'TEXT'))                             changed.push('events.city');
  if (addColumn('events', 'address', 'TEXT'))                          changed.push('events.address');
  if (addColumn('audit_log', 'actor', 'TEXT'))                         changed.push('audit_log.actor');
  if (addColumn('participants', 'extra', 'TEXT'))                      changed.push('participants.extra');
  if (addColumn('participants', 'notes', 'TEXT'))                      changed.push('participants.notes');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sso_sessions (
      ref TEXT PRIMARY KEY, token TEXT NOT NULL,
      event_id TEXT, expires_at TEXT NOT NULL, used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS event_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 1, can_edit INTEGER NOT NULL DEFAULT 0,
      can_participants INTEGER NOT NULL DEFAULT 0, can_export INTEGER NOT NULL DEFAULT 0,
      can_history INTEGER NOT NULL DEFAULT 0, can_messages INTEGER NOT NULL DEFAULT 0,
      can_duplicate INTEGER NOT NULL DEFAULT 0, can_delete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, event_id)
    );
  `);

  return changed;
}

const tenants = fs.readdirSync(TENANTS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (!tenants.length) {
  console.log('[run-migrations] nenhum tenant encontrado em', TENANTS_DIR);
  process.exit(0);
}

let total = 0;
for (const slug of tenants) {
  const dbPath = path.join(TENANTS_DIR, slug, 'rsvp.db');
  if (!fs.existsSync(dbPath)) {
    console.log(`[run-migrations] ${slug}: rsvp.db não encontrado, ignorando`);
    continue;
  }

  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema);

  const changed = applyMigrations(db);
  if (changed.length) {
    console.log(`[run-migrations] ${slug}: migradas → ${changed.join(', ')}`);
  } else {
    console.log(`[run-migrations] ${slug}: schema atualizado (sem novas colunas)`);
  }
  total++;
}

console.log(`[run-migrations] concluído — ${total} tenant(s) processado(s)`);
