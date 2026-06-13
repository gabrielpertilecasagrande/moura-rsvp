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

module.exports = db;
