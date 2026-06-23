-- ============================================================
-- Moura RSVP — Esquema relacional (SQLite)
-- ============================================================
-- Banco relacional simples e portável. Para migrar para
-- PostgreSQL/MySQL no futuro, o modelo abaixo é compatível.
-- Colunas novas são aplicadas por migração idempotente em db.js,
-- preservando bancos já existentes.
-- ============================================================

PRAGMA foreign_keys = ON;

-- Usuários administrativos do sistema
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'editor',   -- 'admin' (acesso total) | 'editor' (sem gestão de usuários)
  status        TEXT    NOT NULL DEFAULT 'ativo',    -- 'pendente' | 'ativo' | 'recusado' | 'inativo'
  last_login    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Eventos
CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,          -- usado na URL pública /rsvp/:slug
  name             TEXT    NOT NULL,
  description      TEXT,
  event_date       TEXT,                             -- AAAA-MM-DD
  event_time       TEXT,                             -- HH:MM
  location         TEXT,                             -- nome do local (ex.: Vila Capuchinhos)
  city             TEXT,                             -- cidade (ex.: Vila Flores/RS)
  address          TEXT,                             -- endereço (opcional)
  cover_image      TEXT,                             -- caminho do arquivo enviado
  client_logo      TEXT,                             -- caminho do arquivo enviado (opcional)
  rsvp_deadline    TEXT,                             -- AAAA-MM-DD (data limite p/ confirmar)
  status           TEXT    NOT NULL DEFAULT 'ativo', -- 'ativo' | 'inativo'
  confirm_message  TEXT    NOT NULL DEFAULT 'Presença confirmada. Obrigado!',
  decline_message  TEXT    NOT NULL DEFAULT 'Resposta registrada. Agradecemos o retorno.',
  expected_guests  INTEGER DEFAULT 0,                -- nº esperado de convidados (base p/ "pendentes")
  whatsapp         TEXT,                             -- nº de WhatsApp da organização (opcional)
  whatsapp_enabled INTEGER DEFAULT 1,                -- 1 = exibe o botão "Falar com a organização"
  force_open       INTEGER DEFAULT 0,                -- 1 = reabre confirmações mesmo após o prazo
  form_config      TEXT    NOT NULL DEFAULT '{}',    -- JSON: quais campos opcionais aparecem
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Participantes / respostas
CREATE TABLE IF NOT EXISTS participants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        INTEGER NOT NULL,
  name            TEXT    NOT NULL,
  name_normalized TEXT    NOT NULL,                  -- chave de deduplicação (sem acento/caixa)
  company         TEXT,
  role            TEXT,
  email           TEXT,
  phone           TEXT,
  response        TEXT    NOT NULL,                  -- 'confirmado' | 'recusado'
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Campos reservados para integração futura (check-in / credenciamento / QR).
  qr_token        TEXT,
  checked_in_at   TEXT,

  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (event_id, name_normalized)                -- garante 1 resposta por pessoa/evento
);

-- Auditoria de respostas e alterações
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER,
  event_id       INTEGER NOT NULL,
  action         TEXT    NOT NULL,                   -- 'criou' | 'atualizou' | 'editou'
  actor          TEXT,                               -- quem alterou: 'Participante (formulário)' ou nome do usuário admin
  old_response   TEXT,
  new_response   TEXT,
  details        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id)       REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_participant  ON audit_log(participant_id);
CREATE INDEX IF NOT EXISTS idx_events_slug        ON events(slug);

-- Registro de atividades dos usuários administrativos (auditoria geral)
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,                                  -- nome/e-mail do usuário admin
  action     TEXT    NOT NULL,                      -- ex.: 'criou evento', 'exportou PDF'
  details    TEXT,                                  -- descrição livre
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

-- Notificações push (Web Push) por tenant
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  endpoint     TEXT    NOT NULL UNIQUE,
  p256dh       TEXT    NOT NULL,
  auth         TEXT    NOT NULL,
  user_agent   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Histórico de envios push por tenant
CREATE TABLE IF NOT EXISTS push_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      INTEGER,
  actor_name    TEXT    NOT NULL,
  ip            TEXT,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  url           TEXT,
  target        TEXT    NOT NULL,
  target_ids    TEXT,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  devices_count INTEGER NOT NULL DEFAULT 0,
  recipients    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_log(created_at);
