CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'operador',
  status        TEXT    NOT NULL DEFAULT 'ativo',
  last_login    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_access (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  event_id          INTEGER NOT NULL,
  can_view          INTEGER NOT NULL DEFAULT 1,
  can_edit          INTEGER NOT NULL DEFAULT 0,
  can_contracts     INTEGER NOT NULL DEFAULT 0,
  can_checklist     INTEGER NOT NULL DEFAULT 1,
  can_files         INTEGER NOT NULL DEFAULT 0,
  can_diary         INTEGER NOT NULL DEFAULT 1,
  can_delete        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,
  action     TEXT    NOT NULL,
  details    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  client        TEXT,
  event_date    TEXT,
  event_time    TEXT,
  location      TEXT,
  city          TEXT,
  responsible   TEXT,
  status        TEXT    NOT NULL DEFAULT 'Planejamento',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company       TEXT    NOT NULL,
  contact       TEXT,
  whatsapp      TEXT,
  email         TEXT,
  city          TEXT,
  category      TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  value          REAL,
  status         TEXT    NOT NULL DEFAULT 'Em negociação',
  payment_status TEXT    NOT NULL DEFAULT 'Pendente',
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  responsible   TEXT,
  due_date      TEXT,
  status        TEXT    NOT NULL DEFAULT 'Pendente',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filename      TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  mime_type     TEXT,
  size          INTEGER,
  uploaded_by   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diary (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry         TEXT    NOT NULL,
  author        TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contracts_event   ON contracts(event_id);
CREATE INDEX IF NOT EXISTS idx_checklist_event   ON checklist(event_id);
CREATE INDEX IF NOT EXISTS idx_files_event       ON event_files(event_id);
CREATE INDEX IF NOT EXISTS idx_diary_event       ON diary(event_id);
CREATE INDEX IF NOT EXISTS idx_activity_created  ON activity_log(created_at);
