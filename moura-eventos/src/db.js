const path = require('path');
const fs   = require('fs');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'eventos.db');

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
} catch {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(dbPath);
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumn(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Migrations idempotentes
addColumn('checklist', 'priority', "TEXT NOT NULL DEFAULT 'Média'");
addColumn('contracts', 'contract_date', 'TEXT');
addColumn('contracts', 'payment_due_date', 'TEXT');
addColumn('contracts', 'payment_date', 'TEXT');
addColumn('event_files', 'category', "TEXT NOT NULL DEFAULT 'Outros'");

// Tabela de comentários do checklist
db.exec(`
  CREATE TABLE IF NOT EXISTS checklist_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES checklist(id) ON DELETE CASCADE,
    author     TEXT,
    comment    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_checklist_comments_task ON checklist_comments(task_id);
`);

module.exports = db;
