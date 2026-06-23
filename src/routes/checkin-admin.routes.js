'use strict';
const express = require('express');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { openTenantDb, runWithDb } = require('../db');
const { requireAuth, SECRET }     = require('../middleware/auth');
const { requireRole }             = require('../utils/permissions');
const { routerDb, organizationExists } = require('../router');
const { logActivity }             = require('../utils/activity');

const router = express.Router();

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_SLUG || 'moura';

// Aceita autenticação dupla: JWT de sessão normal OU service token emitido pelo
// moura-eventos (claim target:'rsvp') para chamadas máquina-a-máquina.
function requireServiceOrAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload && payload.target === 'rsvp') {
        req.serviceCall = true;
        const tenantSlug = String(req.headers['x-tenant-slug'] || DEFAULT_TENANT).toLowerCase().trim();
        if (!organizationExists(tenantSlug)) return res.status(404).json({ error: 'Organização não encontrada.' });
        // Injeta um "admin virtual" com papel gestor para que requireRole funcione.
        req.admin = { id: 0, name: 'Moura One (serviço)', email: payload.email || 'service', role: 'gestor' };
        req.tenantSlug = tenantSlug;
        return runWithDb(tenantSlug, () => next());
      }
    } catch { /* assinatura inválida — tenta sessão normal */ }
  }
  return requireAuth(req, res, next);
}

router.use(requireServiceOrAuth);

// ── POST /api/admin/checkin/setup/:eventId ────────────────────────────────────
// Gera qr_token para todos os confirmados do evento que ainda não têm um.
router.post('/setup/:eventId', requireRole('admin', 'gestor'), (req, res) => {
  const eventId = Number(req.params.eventId);
  const ev = db.prepare('SELECT id, name FROM events WHERE id = ? AND deleted_at IS NULL').get(eventId);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const pending = db.prepare(`
    SELECT id FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL AND qr_token IS NULL
  `).all(eventId);

  const upd = db.prepare('UPDATE participants SET qr_token = ? WHERE id = ?');
  for (const p of pending) upd.run(crypto.randomBytes(16).toString('hex'), p.id);

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL AND qr_token IS NOT NULL
  `).get(eventId).n;

  if (!req.serviceCall) logActivity(req.admin.name, 'gerou QR tokens para check-in', ev.name);
  res.json({ ok: true, generated: pending.length, total_with_qr: total, event_id: eventId });
});

// ── POST /api/admin/checkin/tokens ────────────────────────────────────────────
// Cria um token de operador de check-in para um evento específico.
router.post('/tokens', requireRole('admin', 'gestor'), (req, res) => {
  const { event_id, label, expires_hours = 12 } = req.body || {};
  if (!event_id) return res.status(400).json({ error: 'Informe event_id.' });

  const hours = Number(expires_hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return res.status(400).json({ error: 'expires_hours deve ser entre 1 e 168.' });
  }

  const ev = db.prepare('SELECT id, name FROM events WHERE id = ? AND deleted_at IS NULL').get(Number(event_id));
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const token      = crypto.randomBytes(24).toString('hex');
  const expiresAt  = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const tenantSlug = req.tenantSlug;
  const createdBy  = req.admin.name || req.admin.email;

  routerDb.prepare(`
    INSERT INTO operator_tokens (token, tenant_slug, event_id, label, expires_at, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, tenantSlug, ev.id, label || null, expiresAt, createdBy);

  const ciUrl = (process.env.CHECKIN_URL || (process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') + '/checkin' : '')).replace(/\/$/, '');
  const url   = ciUrl ? `${ciUrl}?token=${token}&event=${ev.id}` : null;

  if (!req.serviceCall) logActivity(createdBy, 'emitiu token de operador para check-in', ev.name);
  res.status(201).json({ token, url, expires_at: expiresAt, event_id: ev.id, label: label || null });
});

// ── GET /api/admin/checkin/tokens ────────────────────────────────────────────
// Lista tokens emitidos para um evento.
router.get('/tokens', (req, res) => {
  const eventId = Number(req.query.event_id);
  if (!eventId) return res.status(400).json({ error: 'Informe event_id.' });
  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NULL').get(eventId);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const tokens = routerDb.prepare(`
    SELECT id, token, label, expires_at, revoked_at, created_by_name, created_at
    FROM operator_tokens
    WHERE tenant_slug = ? AND event_id = ?
    ORDER BY created_at DESC
  `).all(req.tenantSlug, eventId);

  res.json(tokens);
});

// ── DELETE /api/admin/checkin/tokens/:id ─────────────────────────────────────
// Revoga um token de operador.
router.delete('/tokens/:id', requireRole('admin', 'gestor'), (req, res) => {
  const id = Number(req.params.id);
  const t  = routerDb.prepare(
    'SELECT id FROM operator_tokens WHERE id = ? AND tenant_slug = ?'
  ).get(id, req.tenantSlug);
  if (!t) return res.status(404).json({ error: 'Token não encontrado.' });

  routerDb.prepare("UPDATE operator_tokens SET revoked_at = datetime('now') WHERE id = ?").run(id);
  if (!req.serviceCall) logActivity(req.admin.name, 'revogou token de operador', `id=${id}`);
  res.json({ ok: true });
});

// ── GET /api/admin/checkin/events/:id/stats ───────────────────────────────────
// Estatísticas de check-in de um evento (para moura-eventos consultar).
router.get('/events/:id/stats', (req, res) => {
  const eventId = Number(req.params.id);
  const ev = db.prepare('SELECT id, name FROM events WHERE id = ? AND deleted_at IS NULL').get(eventId);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_confirmed,
      SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in,
      SUM(CASE WHEN qr_token IS NOT NULL THEN 1 ELSE 0 END) AS with_qr
    FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL
  `).get(eventId);

  res.json({
    event_id:        eventId,
    total_confirmed: Number(stats.total_confirmed || 0),
    checked_in:      Number(stats.checked_in      || 0),
    with_qr:         Number(stats.with_qr         || 0),
  });
});

// ── GET /api/admin/checkin/events/:id/guests ──────────────────────────────────
// FONTE da sincronização: entrega a lista de convidados CONFIRMADOS de um evento
// para o serviço externo de Check-in (moura-checkin) espelhar no banco próprio.
// O RSVP continua sendo o "dono" da confirmação — este endpoint apenas fornece.
// Autenticado por requireServiceOrAuth (service token target:'rsvp' ou sessão).
router.get('/events/:id/guests', (req, res) => {
  const eventId = Number(req.params.id);
  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NULL').get(eventId);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const guests = db.prepare(`
    SELECT id, name, company, role, email, phone
    FROM participants
    WHERE event_id = ? AND response = 'confirmado' AND deleted_at IS NULL
    ORDER BY name COLLATE NOCASE ASC
  `).all(eventId);

  res.json({ event_id: eventId, total: guests.length, participants: guests });
});

module.exports = router;
