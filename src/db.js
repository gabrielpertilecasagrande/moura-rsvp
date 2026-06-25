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
  addColumn('admins', 'source', 'TEXT');
  // Verificação em duas etapas (2FA por TOTP). Segredo guardado CIFRADO
  // (crypto.js); recovery_codes é um JSON de hashes de uso único. enabled=0 → 2FA
  // desligado (padrão), então contas existentes continuam entrando só com a senha.
  // Aplicado a TODO banco de tenant aberto (presentes e futuros) via applyMigrations.
  addColumn('admins', 'totp_secret', 'TEXT');
  addColumn('admins', 'totp_enabled', 'INTEGER DEFAULT 0');
  addColumn('admins', 'totp_recovery_codes', 'TEXT');
  addColumn('admins', 'totp_enrolled_at', 'TEXT');
  // Anti-reuso do código TOTP: guarda o último passo de tempo (timestep) aceito.
  // Um código com passo menor ou igual a este é recusado — garante uso único por
  // passo (espelha os códigos de recuperação, que já são de uso único).
  addColumn('admins', 'totp_last_step', 'INTEGER');
  addColumn('events', 'whatsapp', 'TEXT');
  addColumn('events', 'force_open', 'INTEGER DEFAULT 0');
  addColumn('events', 'whatsapp_enabled', 'INTEGER DEFAULT 1');
  addColumn('events', 'city', 'TEXT');
  addColumn('events', 'address', 'TEXT');
  // Página de aterrissagem (landing) do evento — usadas por events.routes.js no
  // INSERT/UPDATE. Faltavam no schema/migração: em banco novo a criação de evento
  // falhava ("no column named landing_enabled"). Idempotente (só adiciona se faltar).
  addColumn('events', 'landing_enabled', 'INTEGER DEFAULT 0');
  addColumn('events', 'landing_config', "TEXT DEFAULT '{}'");
  // ID do evento no Moura One (fonte da verdade). Permite que o provisionamento
  // seja IDEMPOTENTE: reenviar os dados ATUALIZA o evento em vez de duplicar.
  addColumn('events', 'source_event_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_event_id)');
  // Código de referência curto/único do evento (logs, rastreio e diferenciação
  // entre eventos do Moura One [MO-] e avulsos [AV-]). Backfill abaixo.
  addColumn('events', 'ref_code', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ref ON events(ref_code)');
  {
    const { genRefCode } = require('./utils/refCode');
    const pending = db.prepare('SELECT id, source_event_id FROM events WHERE ref_code IS NULL OR ref_code = ?').all('');
    if (pending.length) {
      const upd = db.prepare('UPDATE events SET ref_code = ? WHERE id = ?');
      for (const ev of pending) upd.run(genRefCode(db, ev.source_event_id ? 'MO' : 'AV'), ev.id);
    }
  }
  addColumn('audit_log', 'actor', 'TEXT');
  // Rastreabilidade: quem fez, de onde e com qual dispositivo.
  addColumn('audit_log', 'ip',         'TEXT');
  addColumn('audit_log', 'user_agent', 'TEXT');
  addColumn('audit_log', 'origin',     'TEXT');
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

  // Migração automática (uma vez por banco de tenant): cifra company/role de
  // participantes que ainda estejam em texto puro. Roda no primeiro acesso de
  // cada tenant (openTenantDb é cacheado) — cobre tenants atuais e futuros.
  // Segurança: só roda com a chave definida (senão encrypt() seria operação nula
  // e gravaria texto puro). Seleciona apenas linhas NÃO cifradas (NOT LIKE
  // 'enc:%') — em banco já migrado retorna 0 linhas (custo desprezível). Tudo em
  // try/catch para NUNCA travar o boot e em transação (tudo-ou-nada por banco).
  if (process.env.DATA_ENCRYPTION_KEY) {
    try {
      const { encrypt } = require('./utils/crypto');
      const pendentes = db.prepare(
        "SELECT id, company, role FROM participants " +
        "WHERE (company IS NOT NULL AND company NOT LIKE 'enc:%') " +
        "   OR (role    IS NOT NULL AND role    NOT LIKE 'enc:%')"
      ).all();
      if (pendentes.length) {
        const upd = db.prepare('UPDATE participants SET company = ?, role = ? WHERE id = ?');
        db.transaction(() => {
          for (const p of pendentes) {
            const company = (p.company && !String(p.company).startsWith('enc:')) ? encrypt(p.company) : p.company;
            const role    = (p.role    && !String(p.role).startsWith('enc:'))    ? encrypt(p.role)    : p.role;
            upd.run(company, role, p.id);
          }
        })();
        console.log(`[db] migração: ${pendentes.length} participante(s) com company/role cifrado(s)`);
      }
    } catch (e) {
      console.error('[db] migração de cifra de participantes falhou (boot segue normal):', e.message);
    }
  }

  // Lixeira (soft-delete): itens excluídos ficam guardados por um período antes
  // da remoção definitiva. deleted_at = quando foi para a lixeira; deleted_by =
  // quem moveu (auditoria). NULL = item ativo (não está na lixeira).
  addColumn('events',       'deleted_at', 'TEXT');
  addColumn('events',       'deleted_by', 'TEXT');
  addColumn('participants', 'deleted_at', 'TEXT');
  addColumn('participants', 'deleted_by', 'TEXT');
  addColumn('admins',       'deleted_at', 'TEXT');
  addColumn('admins',       'deleted_by', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_deleted       ON events(deleted_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_participants_deleted ON participants(deleted_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_admins_deleted       ON admins(deleted_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_participants_qr      ON participants(qr_token)');

  // Categorias de convidados no RSVP (VIP, Imprensa, etc.) — por evento.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rsvp_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id   INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      color      TEXT    DEFAULT '#2C427E',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_rsvp_cats_event ON rsvp_categories(event_id)');
  addColumn('participants', 'guest_category_id', 'INTEGER');

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
