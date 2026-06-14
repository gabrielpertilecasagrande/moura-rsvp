// Camada de banco relacional (SQLite).
//
// Em produção usamos `better-sqlite3` (rápido, robusto, prebuilds para Linux/Mac/Win).
// Caso ele não esteja instalado/compilado no ambiente, caímos automaticamente para o
// módulo nativo do Node (`node:sqlite`, Node >= 22.5). Ambos expõem a MESMA interface
// usada aqui: db.exec(sql) e db.prepare(sql).get()/.all()/.run() com parâmetros posicionais (?).
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'moura-rsvp.db');

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
addColumn('events', 'whatsapp', 'TEXT');
addColumn('events', 'force_open', 'INTEGER DEFAULT 0');
addColumn('events', 'whatsapp_enabled', 'INTEGER DEFAULT 1');
addColumn('audit_log', 'actor', 'TEXT');

// O primeiro administrador criado pelo seed deve ter acesso total.
// Garante que qualquer conta pré-existente sem papel definido vire 'admin'
// se for a única conta do sistema (evita travar o acesso após a migração).
try {
  const total = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (total === 1) {
    db.exec("UPDATE admins SET role = 'admin', status = 'ativo' WHERE role IS NULL OR role = 'editor'");
  }
} catch {
  /* tabela ainda vazia — sem ação */
}

module.exports = db;
