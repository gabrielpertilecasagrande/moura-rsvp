// Camada de banco relacional (SQLite).
//
// Em produção usamos `better-sqlite3` (rápido, robusto, prebuilds para Linux/Mac/Win).
// Caso ele não esteja instalado/compilado no ambiente, caímos automaticamente para o
// módulo nativo do Node (`node:sqlite`, Node >= 22.5). Ambos expõem a MESMA interface
// usada aqui: db.exec(sql) e db.prepare(sql).get()/.all()/.run() com parâmetros posicionais (?).
const path = require('path');
const fs = require('fs');

// Em produção no Railway, DATA_DIR aponta para o volume persistente (ex.: /app/data).
// Localmente, usa ./data dentro do projeto.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'moura-rsvp.db');
console.log(`[db] banco em: ${DB_PATH}`);

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[db] usando better-sqlite3');
} catch (err) {
  const { DatabaseSync } = require('node:sqlite'); // requer Node >= 22.5 (flag --experimental-sqlite no 22)
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[db] usando node:sqlite (fallback)');
}

// Aplica o esquema (idempotente — usa IF NOT EXISTS).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ------------------------------------------------------------
// Migração idempotente de colunas.
// CREATE TABLE IF NOT EXISTS não altera tabelas já existentes;
// então adicionamos colunas novas aqui, sem apagar dados.
// ------------------------------------------------------------
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}
function addColumn(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] migração: coluna ${table}.${column} adicionada`);
  }
}

addColumn('admins', 'role', "TEXT NOT NULL DEFAULT 'editor'");
addColumn('admins', 'status', "TEXT NOT NULL DEFAULT 'ativo'");
addColumn('admins', 'last_login', 'TEXT');
addColumn('events', 'whatsapp', 'TEXT');
addColumn('events', 'force_open', 'INTEGER DEFAULT 0');
addColumn('events', 'whatsapp_enabled', 'INTEGER DEFAULT 1');
addColumn('events', 'city', 'TEXT');
addColumn('events', 'address', 'TEXT');
addColumn('audit_log', 'actor', 'TEXT');
addColumn('participants', 'extra', 'TEXT'); // respostas dos campos personalizados (JSON)
addColumn('participants', 'notes', 'TEXT'); // observações internas (somente administrativo)

// Controle de acesso por evento: cada linha libera um evento para um usuário,
// com permissões granulares. Admin ignora esta tabela (vê tudo).
db.exec(`
  CREATE TABLE IF NOT EXISTS event_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    can_view INTEGER NOT NULL DEFAULT 1,
    can_edit INTEGER NOT NULL DEFAULT 0,
    can_participants INTEGER NOT NULL DEFAULT 0,
    can_export INTEGER NOT NULL DEFAULT 0,
    can_history INTEGER NOT NULL DEFAULT 0,
    can_messages INTEGER NOT NULL DEFAULT 0,
    can_duplicate INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, event_id)
  );
`);

// Novo modelo de perfis: 'editor' (antigo) passa a ser 'gestor'.
try { db.exec("UPDATE admins SET role = 'gestor' WHERE role = 'editor'"); } catch { /* sem ação */ }

// O primeiro administrador criado pelo seed deve ter acesso total.
// Garante que qualquer conta pré-existente sem papel definido vire 'admin'
// se for a única conta do sistema (evita travar o acesso após a migração).
try {
  const total = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (total === 1) {
    db.exec("UPDATE admins SET role = 'admin', status = 'ativo'");
  }
} catch {
  /* tabela ainda vazia — sem ação */
}

module.exports = db;
