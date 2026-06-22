'use strict';
const express   = require('express');
const jwt       = require('jsonwebtoken');
const db        = require('../db');
const { runWithDb }  = require('../db');
const { routerDb }   = require('../router');
const { rateLimit }  = require('../middleware/rateLimit');
const { SECRET }     = require('../middleware/auth');
const { normalizeName } = require('../utils/normalize');
const { genQrToken }    = require('../utils/qrToken');

const router = express.Router();

const checkinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 300,
  message: 'Muitas requisições de check-in. Aguarde um momento.',
  keyGenerator: (req) => `ci:${req.ip}`,
});

// Aceita operator token (UUID) OU JWT de sessão de admin (mesmas credenciais do Moura One).
function requireOperatorToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  // Tenta operator token primeiro (operadores externos com link UUID)
  const record = routerDb.prepare(
    `SELECT * FROM operator_tokens
     WHERE token = ? AND revoked_at IS NULL AND expires_at > datetime('now')`
  ).get(token);

  if (record) {
    req.operatorToken = record;
    req.tenantSlug    = record.tenant_slug;
    return runWithDb(record.tenant_slug, () => next());
  }

  // Tenta JWT de admin (funcionárias que fazem login com credenciais do Moura One)
  try {
    const payload = jwt.verify(token, SECRET);
    // Rejeita tokens SSO/service (têm claim `target`) — apenas sessões normais
    if (payload?.tenant_slug && !payload?.target) {
      req.admin        = { id: payload.id, name: payload.name, email: payload.email, role: payload.role };
      req.operatorToken = { event_id: null, tenant_slug: payload.tenant_slug };
      req.tenantSlug   = payload.tenant_slug;
      return runWithDb(payload.tenant_slug, () => next());
    }
  } catch { /* JWT inválido ou expirado */ }

  return res.status(401).json({ error: 'Token inválido ou expirado.' });
}

router.use(checkinLimiter, requireOperatorToken);

// ── GET /api/checkin/events ──────────────────────────────────────────────────
// Lista os eventos acessíveis ao token do operador.
router.get('/events', (req, res) => {
  const { event_id } = req.operatorToken;
  if (event_id) {
    const ev = db.prepare(`
      SELECT id, name, slug, event_date, event_time, location, city, has_tables, use_categories
      FROM events WHERE id = ? AND deleted_at IS NULL
    `).get(event_id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    return res.json([ev]);
  }
  const evs = db.prepare(`
    SELECT e.id, e.name, e.slug, e.event_date, e.event_time, e.location, e.city,
           e.has_tables, e.use_categories,
           (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.response = 'confirmado' AND p.deleted_at IS NULL) AS total_confirmed,
           (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.response = 'confirmado' AND p.deleted_at IS NULL AND p.checked_in_at IS NOT NULL) AS checked_in
    FROM events e WHERE e.deleted_at IS NULL ORDER BY e.event_date DESC LIMIT 50
  `).all();
  res.json(evs);
});

// ── POST /api/checkin/events ──────────────────────────────────────────────────
// Cria um evento (usado pelo botão "+ Novo evento" do app de check-in).
router.post('/events', (req, res) => {
  // Operadores com link de 1 evento não criam eventos.
  if (req.operatorToken && req.operatorToken.event_id) return res.status(403).json({ error: 'Sem permissão para criar eventos.' });
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do evento.' });

  // Gera um slug único a partir do nome.
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'evento';
  let slug = base, n = 1;
  while (db.prepare('SELECT 1 FROM events WHERE slug = ?').get(slug)) { slug = `${base}-${++n}`; }

  const info = db.prepare(`
    INSERT INTO events (slug, name, event_date, location, has_tables, use_categories)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(slug, name, String(b.event_date || '').trim() || null, String(b.location || '').trim() || null,
         b.has_tables ? 1 : 0, b.use_categories ? 1 : 0);
  const ev = db.prepare('SELECT id, name, slug, event_date, event_time, location, city, has_tables, use_categories FROM events WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, event: ev });
});

// ── GET /api/checkin/events/:id/stats ────────────────────────────────────────
router.get('/events/:id/stats', (req, res) => {
  const reqId = Number(req.params.id);
  const { event_id } = req.operatorToken;
  if (event_id && event_id !== reqId) return res.status(403).json({ error: 'Acesso negado a este evento.' });

  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NULL').get(reqId);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_confirmed,
      SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
    FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL
  `).get(reqId);

  res.json({
    event_id:        reqId,
    total_confirmed: Number(stats.total_confirmed || 0),
    checked_in:      Number(stats.checked_in      || 0),
  });
});

// ── GET /api/checkin/events/:id/participants ──────────────────────────────────
// Lista convidados confirmados com status de check-in. Suporta busca por nome.
router.get('/events/:id/participants', (req, res) => {
  const reqId = Number(req.params.id);
  const { event_id } = req.operatorToken;
  if (event_id && event_id !== reqId) return res.status(403).json({ error: 'Acesso negado a este evento.' });

  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NULL').get(reqId);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const q = String(req.query.q || '').trim();
  let sql = `SELECT id, name, company, role, phone, checked_in_at, qr_token, table_number, category_id
             FROM participants
             WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL`;
  const params = [reqId];
  if (q) {
    sql += ' AND (name LIKE ? OR company LIKE ? OR table_number LIKE ? OR phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY name COLLATE NOCASE ASC LIMIT 2000';

  res.json(db.prepare(sql).all(...params));
});

// ── GET /api/checkin/lookup?qr=<token> ───────────────────────────────────────
// Busca participante pelo token de QR Code (leitura por câmera).
router.get('/lookup', (req, res) => {
  const qr = String(req.query.qr || '').trim();
  if (!qr) return res.status(400).json({ error: 'Informe o parâmetro qr.' });

  const { event_id } = req.operatorToken;
  let sql = `SELECT p.id, p.name, p.company, p.role, p.event_id, p.checked_in_at, p.qr_token,
                    e.name AS event_name, e.event_date, e.event_time, e.location
             FROM participants p
             JOIN events e ON e.id = p.event_id
             WHERE p.qr_token = ? AND p.response = 'confirmado' AND p.deleted_at IS NULL`;
  const params = [qr];
  if (event_id) { sql += ' AND p.event_id = ?'; params.push(event_id); }

  const p = db.prepare(sql).get(...params);
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado ou QR inválido.' });
  res.json(p);
});

// ── POST /api/checkin/register ────────────────────────────────────────────────
// Registra a chegada de um participante.
router.post('/register', (req, res) => {
  const { participant_id } = req.body || {};
  if (!participant_id) return res.status(400).json({ error: 'Informe participant_id.' });

  const { event_id } = req.operatorToken;
  const p = db.prepare(
    'SELECT id, name, event_id, response, checked_in_at FROM participants WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(participant_id));

  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
  if (p.response !== 'confirmado') return res.status(400).json({ error: 'Participante não confirmou presença.' });
  if (event_id && p.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado a este evento.' });

  if (p.checked_in_at) {
    return res.json({ ok: true, already_checked_in: true, participant_id: p.id, name: p.name, checked_in_at: p.checked_in_at });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE participants SET checked_in_at = ? WHERE id = ?").run(now, p.id);
  res.json({ ok: true, already_checked_in: false, participant_id: p.id, name: p.name, checked_in_at: now });
});

// ── POST /api/checkin/unregister ──────────────────────────────────────────────
// Desfaz a chegada de um participante (desmarca o check-in).
router.post('/unregister', (req, res) => {
  const { participant_id } = req.body || {};
  if (!participant_id) return res.status(400).json({ error: 'Informe participant_id.' });

  const { event_id } = req.operatorToken;
  const p = db.prepare(
    'SELECT id, name, event_id, response, checked_in_at FROM participants WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(participant_id));

  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
  if (event_id && p.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado a este evento.' });

  if (!p.checked_in_at) {
    return res.json({ ok: true, was_checked_in: false, participant_id: p.id, name: p.name });
  }

  db.prepare("UPDATE participants SET checked_in_at = NULL WHERE id = ?").run(p.id);
  res.json({ ok: true, was_checked_in: true, participant_id: p.id, name: p.name });
});

// ── Helper: valida que o evento existe e que o token tem acesso a ele ──────────
function resolveEvent(req, res) {
  const reqId = Number(req.params.id);
  const { event_id } = req.operatorToken;
  if (event_id && event_id !== reqId) { res.status(403).json({ error: 'Acesso negado a este evento.' }); return null; }
  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NULL').get(reqId);
  if (!ev) { res.status(404).json({ error: 'Evento não encontrado.' }); return null; }
  return reqId;
}

// ════════════════════════════════════════════════════════════════════════════
//  MESAS (checkin_tables)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/checkin/events/:id/tables ────────────────────────────────────────
// Lista as mesas configuradas + ocupação calculada a partir dos convidados.
router.get('/events/:id/tables', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const tables = db.prepare(
    'SELECT id, name, capacity, sort_order FROM checkin_tables WHERE event_id = ? ORDER BY sort_order, id'
  ).all(reqId);
  // Conta convidados (alocados e presentes) por nome de mesa.
  const counts = db.prepare(`
    SELECT table_number AS name,
           COUNT(*) AS allocated,
           SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS present
    FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL
      AND table_number IS NOT NULL AND table_number <> ''
    GROUP BY table_number
  `).all(reqId);
  const byName = {};
  counts.forEach(c => { byName[String(c.name).toLowerCase()] = c; });
  const out = tables.map(t => {
    const c = byName[String(t.name).toLowerCase()] || { allocated: 0, present: 0 };
    return { ...t, allocated: Number(c.allocated || 0), present: Number(c.present || 0) };
  });
  res.json(out);
});

// ── POST /api/checkin/events/:id/tables/generate ──────────────────────────────
// Gera N mesas numeradas (1..N) com a capacidade informada. Não duplica nomes.
router.post('/events/:id/tables/generate', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const count    = Math.max(1, Math.min(500, Number(req.body?.count    || 0)));
  const capacity = Math.max(1, Math.min(100, Number(req.body?.capacity || 8)));
  if (!count) return res.status(400).json({ error: 'Informe a quantidade de mesas.' });
  const existing = new Set(db.prepare('SELECT name FROM checkin_tables WHERE event_id = ?').all(reqId).map(r => String(r.name)));
  const ins = db.prepare('INSERT INTO checkin_tables (event_id, name, capacity, sort_order) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (let i = 1; i <= count; i++) {
      if (existing.has(String(i))) continue;
      ins.run(reqId, String(i), capacity, i);
    }
  });
  tx();
  res.json({ ok: true });
});

// ── POST /api/checkin/events/:id/tables ───────────────────────────────────────
// Adiciona uma mesa avulsa.
router.post('/events/:id/tables', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const name = String(req.body?.name || '').trim();
  const capacity = Math.max(1, Math.min(100, Number(req.body?.capacity || 8)));
  if (!name) return res.status(400).json({ error: 'Informe o nome da mesa.' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM checkin_tables WHERE event_id = ?').get(reqId).m;
  const info = db.prepare('INSERT INTO checkin_tables (event_id, name, capacity, sort_order) VALUES (?, ?, ?, ?)')
    .run(reqId, name, capacity, maxOrder + 1);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── PATCH /api/checkin/tables/:tid ────────────────────────────────────────────
router.patch('/tables/:tid', (req, res) => {
  const { event_id } = req.operatorToken;
  const t = db.prepare('SELECT id, event_id, name FROM checkin_tables WHERE id = ?').get(Number(req.params.tid));
  if (!t) return res.status(404).json({ error: 'Mesa não encontrada.' });
  if (event_id && t.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado.' });
  const name = req.body?.name != null ? String(req.body.name).trim() : t.name;
  const capacity = req.body?.capacity != null ? Math.max(1, Math.min(100, Number(req.body.capacity))) : null;
  if (!name) return res.status(400).json({ error: 'Informe o nome da mesa.' });
  if (capacity != null) db.prepare('UPDATE checkin_tables SET name = ?, capacity = ? WHERE id = ?').run(name, capacity, t.id);
  else db.prepare('UPDATE checkin_tables SET name = ? WHERE id = ?').run(name, t.id);
  res.json({ ok: true });
});

// ── DELETE /api/checkin/tables/:tid ───────────────────────────────────────────
router.delete('/tables/:tid', (req, res) => {
  const { event_id } = req.operatorToken;
  const t = db.prepare('SELECT id, event_id FROM checkin_tables WHERE id = ?').get(Number(req.params.tid));
  if (!t) return res.status(404).json({ error: 'Mesa não encontrada.' });
  if (event_id && t.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado.' });
  db.prepare('DELETE FROM checkin_tables WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORIAS (checkin_categories)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/checkin/events/:id/categories ────────────────────────────────────
router.get('/events/:id/categories', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const cats = db.prepare(
    'SELECT id, name, color, sort_order FROM checkin_categories WHERE event_id = ? ORDER BY sort_order, id'
  ).all(reqId);
  const counts = db.prepare(`
    SELECT category_id AS id, COUNT(*) AS total
    FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL AND category_id IS NOT NULL
    GROUP BY category_id
  `).all(reqId);
  const byId = {}; counts.forEach(c => { byId[c.id] = Number(c.total || 0); });
  res.json(cats.map(c => ({ ...c, total: byId[c.id] || 0 })));
});

// ── POST /api/checkin/events/:id/categories ───────────────────────────────────
router.post('/events/:id/categories', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const name  = String(req.body?.name  || '').trim();
  const color = String(req.body?.color || '#2C427E').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome da categoria.' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM checkin_categories WHERE event_id = ?').get(reqId).m;
  const info = db.prepare('INSERT INTO checkin_categories (event_id, name, color, sort_order) VALUES (?, ?, ?, ?)')
    .run(reqId, name, color, maxOrder + 1);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── POST /api/checkin/events/:id/categories/seed ──────────────────────────────
// Cria o conjunto padrão de categorias (VIP, Imprensa, etc.) se ainda não houver.
router.post('/events/:id/categories/seed', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const has = db.prepare('SELECT COUNT(*) AS n FROM checkin_categories WHERE event_id = ?').get(reqId).n;
  if (has > 0) return res.json({ ok: true, skipped: true });
  const DEFAULTS = [
    ['VIP', '#B57614'], ['Imprensa', '#2C427E'], ['Patrocinador', '#15795B'],
    ['Expositor', '#7A2733'], ['Convidado', '#2BC2CE'], ['Equipe', '#6E6F72'],
    ['Organização', '#A4343A'], ['Fornecedor', '#5B4B8A'],
  ];
  const ins = db.prepare('INSERT INTO checkin_categories (event_id, name, color, sort_order) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => DEFAULTS.forEach((c, i) => ins.run(reqId, c[0], c[1], i)));
  tx();
  res.json({ ok: true });
});

// ── PATCH /api/checkin/categories/:cid ────────────────────────────────────────
router.patch('/categories/:cid', (req, res) => {
  const { event_id } = req.operatorToken;
  const c = db.prepare('SELECT id, event_id, name, color FROM checkin_categories WHERE id = ?').get(Number(req.params.cid));
  if (!c) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (event_id && c.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado.' });
  const name  = req.body?.name  != null ? String(req.body.name).trim()  : c.name;
  const color = req.body?.color != null ? String(req.body.color).trim() : c.color;
  if (!name) return res.status(400).json({ error: 'Informe o nome da categoria.' });
  db.prepare('UPDATE checkin_categories SET name = ?, color = ? WHERE id = ?').run(name, color, c.id);
  res.json({ ok: true });
});

// ── DELETE /api/checkin/categories/:cid ───────────────────────────────────────
router.delete('/categories/:cid', (req, res) => {
  const { event_id } = req.operatorToken;
  const c = db.prepare('SELECT id, event_id FROM checkin_categories WHERE id = ?').get(Number(req.params.cid));
  if (!c) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (event_id && c.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado.' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE participants SET category_id = NULL WHERE category_id = ?').run(c.id);
    db.prepare('DELETE FROM checkin_categories WHERE id = ?').run(c.id);
  });
  tx();
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  ATRIBUIÇÃO (mesa / categoria de um convidado)
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/checkin/participant/:pid/assign ─────────────────────────────────
// Define a mesa e/ou a categoria de um convidado. Campos ausentes não mudam.
router.post('/participant/:pid/assign', (req, res) => {
  const { event_id } = req.operatorToken;
  const p = db.prepare(
    'SELECT id, event_id, table_number, category_id FROM participants WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(req.params.pid));
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado.' });
  if (event_id && p.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado a este evento.' });

  const sets = [], vals = [];
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'table_number')) {
    const tn = req.body.table_number;
    sets.push('table_number = ?');
    vals.push(tn == null || String(tn).trim() === '' ? null : String(tn).trim());
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'category_id')) {
    const cid = req.body.category_id;
    sets.push('category_id = ?');
    vals.push(cid == null || cid === '' ? null : Number(cid));
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  vals.push(p.id);
  db.prepare(`UPDATE participants SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const updated = db.prepare('SELECT id, table_number, category_id FROM participants WHERE id = ?').get(p.id);
  res.json({ ok: true, ...updated });
});

// Nome de quem está operando (admin via JWT ou operador via link), p/ auditoria.
function actorName(req) {
  if (req.admin && (req.admin.name || req.admin.email)) return req.admin.name || req.admin.email;
  return 'Operador (check-in)';
}
function logAudit(participantId, eventId, action, actor, details) {
  try {
    db.prepare(`INSERT INTO audit_log (participant_id, event_id, action, actor, details) VALUES (?, ?, ?, ?, ?)`)
      .run(participantId || null, eventId, action, actor, details || null);
  } catch { /* auditoria não deve quebrar a operação */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENTO — editar configurações do check-in / excluir
// ════════════════════════════════════════════════════════════════════════════

// ── PATCH /api/checkin/events/:id ─────────────────────────────────────────────
// Edita nome, data, local e os toggles de mesas/categorias. Campos ausentes não mudam.
router.patch('/events/:id', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.name        != null) { const n = String(b.name).trim(); if (!n) return res.status(400).json({ error: 'O nome não pode ficar vazio.' }); sets.push('name = ?'); vals.push(n); }
  if (b.event_date  != null) { sets.push('event_date = ?'); vals.push(String(b.event_date).trim() || null); }
  if (b.location    != null) { sets.push('location = ?');   vals.push(String(b.location).trim() || null); }
  if (b.has_tables     != null) { sets.push('has_tables = ?');     vals.push(b.has_tables ? 1 : 0); }
  if (b.use_categories != null) { sets.push('use_categories = ?'); vals.push(b.use_categories ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  sets.push("updated_at = datetime('now')");
  vals.push(reqId);
  db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const ev = db.prepare('SELECT id, name, slug, event_date, event_time, location, city, has_tables, use_categories FROM events WHERE id = ?').get(reqId);
  res.json({ ok: true, event: ev });
});

// ── DELETE /api/checkin/events/:id ────────────────────────────────────────────
// Move o evento para a lixeira (soft-delete, recuperável).
router.delete('/events/:id', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  // Operadores com link de 1 evento não podem excluir o evento.
  if (req.operatorToken && req.operatorToken.event_id) return res.status(403).json({ error: 'Sem permissão para excluir o evento.' });
  db.prepare("UPDATE events SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(actorName(req), reqId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  CONVIDADOS — adicionar / editar / remover / importar / histórico
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/checkin/events/:id/participants ─────────────────────────────────
// Adiciona um convidado confirmado ao evento.
router.post('/events/:id/participants', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do convidado.' });
  const normalized = normalizeName(name);

  const existing = db.prepare('SELECT id, deleted_at FROM participants WHERE event_id = ? AND name_normalized = ?').get(reqId, normalized);
  if (existing && !existing.deleted_at) return res.status(409).json({ error: 'Já existe um convidado com esse nome neste evento.' });

  const company = b.company != null ? String(b.company).trim() || null : null;
  const phone   = b.phone   != null ? String(b.phone).trim()   || null : null;
  const notes   = b.notes   != null ? String(b.notes).trim()   || null : null;
  const tableNo = b.table_number != null && String(b.table_number).trim() !== '' ? String(b.table_number).trim() : null;
  const catId   = b.category_id != null && b.category_id !== '' ? Number(b.category_id) : null;

  let id;
  if (existing) {
    // Reaproveita o registro que estava na lixeira.
    db.prepare(`UPDATE participants SET name=?, name_normalized=?, company=?, phone=?, notes=?, table_number=?, category_id=?, response='confirmado', qr_token=COALESCE(qr_token, ?), checked_in_at=NULL, deleted_at=NULL, deleted_by=NULL, updated_at=datetime('now') WHERE id=?`)
      .run(name, normalized, company, phone, notes, tableNo, catId, genQrToken(), existing.id);
    id = existing.id;
  } else {
    const info = db.prepare(`INSERT INTO participants (event_id, name, name_normalized, company, phone, notes, table_number, category_id, response, qr_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmado', ?)`)
      .run(reqId, name, normalized, company, phone, notes, tableNo, catId, genQrToken());
    id = info.lastInsertRowid;
  }
  logAudit(id, reqId, 'criou', actorName(req), 'Convidado adicionado pelo check-in');
  const p = db.prepare('SELECT id, name, company, role, phone, checked_in_at, qr_token, table_number, category_id FROM participants WHERE id = ?').get(id);
  res.json({ ok: true, participant: p });
});

// ── PATCH /api/checkin/participant/:pid ───────────────────────────────────────
// Edita os dados de um convidado.
router.patch('/participant/:pid', (req, res) => {
  const { event_id } = req.operatorToken;
  const p = db.prepare('SELECT id, event_id, name FROM participants WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.pid));
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado.' });
  if (event_id && p.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado a este evento.' });

  const b = req.body || {};
  const sets = [], vals = [];
  if (b.name != null) {
    const n = String(b.name).trim();
    if (!n) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
    const normalized = normalizeName(n);
    const dup = db.prepare('SELECT id FROM participants WHERE event_id = ? AND name_normalized = ? AND id <> ? AND deleted_at IS NULL').get(p.event_id, normalized, p.id);
    if (dup) return res.status(409).json({ error: 'Já existe outro convidado com esse nome.' });
    sets.push('name = ?', 'name_normalized = ?'); vals.push(n, normalized);
  }
  if (b.company != null)      { sets.push('company = ?');      vals.push(String(b.company).trim() || null); }
  if (b.phone != null)        { sets.push('phone = ?');        vals.push(String(b.phone).trim() || null); }
  if (b.notes != null)        { sets.push('notes = ?');        vals.push(String(b.notes).trim() || null); }
  if (Object.prototype.hasOwnProperty.call(b, 'table_number')) { sets.push('table_number = ?'); vals.push(b.table_number == null || String(b.table_number).trim() === '' ? null : String(b.table_number).trim()); }
  if (Object.prototype.hasOwnProperty.call(b, 'category_id'))  { sets.push('category_id = ?');  vals.push(b.category_id == null || b.category_id === '' ? null : Number(b.category_id)); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  sets.push("updated_at = datetime('now')");
  vals.push(p.id);
  db.prepare(`UPDATE participants SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  logAudit(p.id, p.event_id, 'editou', actorName(req), 'Convidado editado pelo check-in');
  const out = db.prepare('SELECT id, name, company, role, phone, checked_in_at, qr_token, table_number, category_id FROM participants WHERE id = ?').get(p.id);
  res.json({ ok: true, participant: out });
});

// ── DELETE /api/checkin/participant/:pid ──────────────────────────────────────
// Remove um convidado (lixeira / soft-delete, recuperável).
router.delete('/participant/:pid', (req, res) => {
  const { event_id } = req.operatorToken;
  const p = db.prepare('SELECT id, event_id, name FROM participants WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.pid));
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado.' });
  if (event_id && p.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado a este evento.' });
  db.prepare("UPDATE participants SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(actorName(req), p.id);
  logAudit(p.id, p.event_id, 'removeu', actorName(req), 'Convidado removido pelo check-in');
  res.json({ ok: true });
});

// ── POST /api/checkin/events/:id/participants/bulk ────────────────────────────
// Importa uma lista de convidados. Body: { rows: [{ name, company?, phone?, table_number? }] }
router.post('/events/:id/participants/bulk', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nenhuma linha para importar.' });

  let added = 0, skipped = 0;
  const findNorm = db.prepare('SELECT id, deleted_at FROM participants WHERE event_id = ? AND name_normalized = ?');
  const ins = db.prepare(`INSERT INTO participants (event_id, name, name_normalized, company, phone, table_number, response, qr_token) VALUES (?, ?, ?, ?, ?, ?, 'confirmado', ?)`);
  const revive = db.prepare(`UPDATE participants SET name=?, company=?, phone=?, table_number=?, response='confirmado', qr_token=COALESCE(qr_token, ?), deleted_at=NULL, deleted_by=NULL, updated_at=datetime('now') WHERE id=?`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      const name = String(r?.name || '').trim();
      if (!name) { skipped++; continue; }
      const normalized = normalizeName(name);
      const company = r.company != null ? String(r.company).trim() || null : null;
      const phone   = r.phone   != null ? String(r.phone).trim()   || null : null;
      const tableNo = r.table_number != null && String(r.table_number).trim() !== '' ? String(r.table_number).trim() : null;
      const ex = findNorm.get(reqId, normalized);
      if (ex && !ex.deleted_at) { skipped++; continue; }
      if (ex) revive.run(name, company, phone, tableNo, genQrToken(), ex.id);
      else    ins.run(reqId, name, normalized, company, phone, tableNo, genQrToken());
      added++;
    }
  });
  tx();
  logAudit(null, reqId, 'criou', actorName(req), `Importação de lista pelo check-in (${added} adicionados)`);
  res.json({ ok: true, added, skipped });
});

// ── GET /api/checkin/participant/:pid/history ─────────────────────────────────
// Ficha + linha do tempo de um convidado.
router.get('/participant/:pid/history', (req, res) => {
  const { event_id } = req.operatorToken;
  const p = db.prepare('SELECT id, event_id, name, company, phone, table_number, category_id, checked_in_at, created_at FROM participants WHERE id = ?').get(Number(req.params.pid));
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado.' });
  if (event_id && p.event_id !== event_id) return res.status(403).json({ error: 'Acesso negado a este evento.' });
  const log = db.prepare('SELECT action, actor, details, created_at FROM audit_log WHERE participant_id = ? ORDER BY created_at DESC LIMIT 50').all(p.id);
  res.json({ participant: p, log });
});

// ── GET /api/checkin/events/:id/activity ──────────────────────────────────────
// Feed de atividades do evento (quem fez o quê) — usado no relatório.
router.get('/events/:id/activity', (req, res) => {
  const reqId = resolveEvent(req, res); if (reqId === null) return;
  const rows = db.prepare(`
    SELECT a.action, a.actor, a.details, a.created_at, p.name AS participant_name
    FROM audit_log a LEFT JOIN participants p ON p.id = a.participant_id
    WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT 200
  `).all(reqId);
  res.json(rows);
});


module.exports = router;
