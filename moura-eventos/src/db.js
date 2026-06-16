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
addColumn('events', 'event_type', 'TEXT');
addColumn('suppliers', 'website', 'TEXT');
addColumn('suppliers', 'instagram', 'TEXT');
addColumn('suppliers', 'state', 'TEXT');
addColumn('suppliers', 'rating', 'INTEGER DEFAULT 0');

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

// Tabela de modelos de checklist por tipo de evento
db.exec(`
  CREATE TABLE IF NOT EXISTS event_type_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL,
    title       TEXT NOT NULL,
    priority    TEXT NOT NULL DEFAULT 'Média',
    responsible TEXT,
    sort_order  INTEGER DEFAULT 0
  );
`);

// Seed dos modelos se ainda não existirem
const templateCount = db.prepare('SELECT COUNT(*) AS n FROM event_type_templates').get().n;
if (templateCount === 0) {
  const insert = db.prepare(
    'INSERT INTO event_type_templates (event_type, title, priority, sort_order) VALUES (?, ?, ?, ?)'
  );
  const templates = [
    ['Social', 'Definir buffet e cardápio', 'Alta', 1],
    ['Social', 'Contratar decoração', 'Alta', 2],
    ['Social', 'Contratar música ao vivo ou DJ', 'Média', 3],
    ['Social', 'Definir fotografia e filmagem', 'Média', 4],
    ['Social', 'Confirmar lista de convidados', 'Alta', 5],
    ['Social corporativo', 'Definir pauta e programação', 'Alta', 1],
    ['Social corporativo', 'Reservar espaço do evento', 'Crítica', 2],
    ['Social corporativo', 'Contratar buffet corporativo', 'Alta', 3],
    ['Social corporativo', 'Contratar audiovisual e projeção', 'Alta', 4],
    ['Social corporativo', 'Enviar convites e confirmar presença', 'Média', 5],
    ['Fórum', 'Definir tema e palestrantes', 'Alta', 1],
    ['Fórum', 'Reservar auditório', 'Crítica', 2],
    ['Fórum', 'Divulgação nas redes sociais', 'Média', 3],
    ['Fórum', 'Contratar sonorização e projeção', 'Alta', 4],
    ['Fórum', 'Montar credenciamento', 'Alta', 5],
    ['Congresso', 'Definir comissão organizadora', 'Alta', 1],
    ['Congresso', 'Reservar centro de convenções', 'Crítica', 2],
    ['Congresso', 'Abrir submissão de trabalhos', 'Alta', 3],
    ['Congresso', 'Contratar coffee break e almoço', 'Média', 4],
    ['Congresso', 'Produzir anais e certificados', 'Média', 5],
    ['Convenção', 'Definir tema da convenção', 'Alta', 1],
    ['Convenção', 'Reservar hotel ou espaço', 'Crítica', 2],
    ['Convenção', 'Contratar decoração e palco', 'Alta', 3],
    ['Convenção', 'Organizar transfer de participantes', 'Média', 4],
    ['Convenção', 'Preparar materiais e brindes', 'Média', 5],
    ['Seminário', 'Definir grade de conteúdo', 'Alta', 1],
    ['Seminário', 'Contratar espaço', 'Crítica', 2],
    ['Seminário', 'Convidar palestrantes', 'Alta', 3],
    ['Seminário', 'Divulgar inscrições', 'Média', 4],
    ['Seminário', 'Emitir certificados', 'Baixa', 5],
    ['Feira', 'Contratar pavilhão ou espaço', 'Crítica', 1],
    ['Feira', 'Vender estandes para expositores', 'Alta', 2],
    ['Feira', 'Contratar montagem de estrutura', 'Alta', 3],
    ['Feira', 'Credenciamento de visitantes', 'Média', 4],
    ['Feira', 'Divulgação e marketing', 'Alta', 5],
    ['Jantar', 'Definir menu e degustação', 'Alta', 1],
    ['Jantar', 'Contratar espaço e decoração', 'Crítica', 2],
    ['Jantar', 'Confirmar lista de convidados', 'Alta', 3],
    ['Jantar', 'Contratar música ao vivo', 'Média', 4],
    ['Jantar', 'Montar mesa e cenografia', 'Média', 5],
    ['Lançamento', 'Definir data e local do lançamento', 'Crítica', 1],
    ['Lançamento', 'Convidar imprensa e influencers', 'Alta', 2],
    ['Lançamento', 'Contratar produção e cenografia', 'Alta', 3],
    ['Lançamento', 'Preparar release e kit mídia', 'Média', 4],
    ['Lançamento', 'Fotografar e registrar o evento', 'Média', 5],
    ['Reunião', 'Definir pauta e participantes', 'Alta', 1],
    ['Reunião', 'Reservar sala e equipamentos', 'Média', 2],
    ['Reunião', 'Enviar convites e confirmações', 'Média', 3],
    ['Reunião', 'Preparar apresentação', 'Alta', 4],
    ['Reunião', 'Registrar ata após a reunião', 'Baixa', 5],
  ];
  const insertAll = db.transaction((rows) => { for (const r of rows) insert.run(...r); });
  insertAll(templates);
}

module.exports = db;
