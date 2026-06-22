'use strict';
const express   = require('express');
const jwt       = require('jsonwebtoken');
const db        = require('../db');
const { runWithDb }  = require('../db');
const { routerDb }   = require('../router');
const { rateLimit }  = require('../middleware/rateLimit');
const { SECRET }     = require('../middleware/auth');

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
      SELECT id, name, slug, event_date, event_time, location, city
      FROM events WHERE id = ? AND deleted_at IS NULL
    `).get(event_id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    return res.json([ev]);
  }
  const evs = db.prepare(`
    SELECT id, name, slug, event_date, event_time, location, city
    FROM events WHERE deleted_at IS NULL ORDER BY event_date DESC LIMIT 50
  `).all();
  res.json(evs);
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
  let sql = `SELECT id, name, company, role, checked_in_at, qr_token
             FROM participants
             WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL`;
  const params = [reqId];
  if (q) {
    sql += ' AND name LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY name COLLATE NOCASE ASC LIMIT 100';

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

module.exports = router;
