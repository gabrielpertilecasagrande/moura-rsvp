'use strict';
// Lixeira — área administrativa que reúne, num só lugar, os itens excluídos:
// Eventos, Convidados (participantes) e Usuários. Permite visualizar, restaurar
// ou excluir permanentemente. Itens ficam guardados por 90 dias (ver trash.js).
//
// Apenas administradores acessam esta área.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const { registerAdminEmail } = require('../router');
const {
  RETENTION_DAYS, hardDeleteEvent, hardDeleteParticipant, hardDeleteAdmin,
} = require('../utils/trash');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const who = (req) => req.admin.name || req.admin.email || 'Administrador';
const PURGE_AT = `datetime(deleted_at, '+${RETENTION_DAYS} days')`;

// ── Listagem geral da lixeira ─────────────────────────────────────────────────
router.get('/', (_req, res) => {
  const events = db.prepare(`
    SELECT e.id, e.name, e.slug, e.event_date, e.location, e.city,
           e.deleted_at, e.deleted_by, ${PURGE_AT.replace(/deleted_at/g, 'e.deleted_at')} AS purge_at,
           (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count
      FROM events e
     WHERE e.deleted_at IS NOT NULL
     ORDER BY e.deleted_at DESC
  `).all().map((r) => ({ ...r, type: 'event', retention_days: RETENTION_DAYS }));

  // Convidados na lixeira — só os de eventos ATIVOS (os de um evento que também
  // está na lixeira voltam junto com o evento, então não aparecem aqui).
  const participants = db.prepare(`
    SELECT p.id, p.name, p.email, p.phone, p.company, p.response,
           p.deleted_at, p.deleted_by, ${PURGE_AT.replace(/deleted_at/g, 'p.deleted_at')} AS purge_at,
           e.id AS event_id, e.name AS event_name
      FROM participants p JOIN events e ON e.id = p.event_id
     WHERE p.deleted_at IS NOT NULL AND e.deleted_at IS NULL
     ORDER BY p.deleted_at DESC
  `).all().map((r) => ({ ...r, type: 'participant', retention_days: RETENTION_DAYS }));

  const users = db.prepare(`
    SELECT id, name, email, role, status,
           deleted_at, deleted_by, ${PURGE_AT} AS purge_at
      FROM admins
     WHERE deleted_at IS NOT NULL
     ORDER BY deleted_at DESC
  `).all().map((r) => ({ ...r, type: 'user', retention_days: RETENTION_DAYS }));

  res.json({ events, participants, users, retention_days: RETENTION_DAYS });
});

// ── Pré-visualização (antes de restaurar) ─────────────────────────────────────
router.get('/event/:id/preview', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado na lixeira.' });
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN response = 'confirmado' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN response = 'recusado'   THEN 1 ELSE 0 END) AS declined
    FROM participants WHERE event_id = ?
  `).get(e.id);
  res.json({
    event: {
      id: e.id, name: e.name, slug: e.slug, event_date: e.event_date,
      event_time: e.event_time, location: e.location, city: e.city, status: e.status,
    },
    counts: { total: Number(counts.total || 0), confirmed: Number(counts.confirmed || 0), declined: Number(counts.declined || 0) },
  });
});

router.get('/participant/:id/preview', (req, res) => {
  const p = db.prepare(`
    SELECT p.*, e.name AS event_name FROM participants p JOIN events e ON e.id = p.event_id
     WHERE p.id = ? AND p.deleted_at IS NOT NULL
  `).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado na lixeira.' });
  res.json({
    participant: {
      id: p.id, name: p.name, event_name: p.event_name, company: p.company, role: p.role,
      email: p.email, phone: p.phone, response: p.response,
    },
  });
});

router.get('/user/:id/preview', (req, res) => {
  const u = db.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado na lixeira.' });
  const accessCount = db.prepare('SELECT COUNT(*) c FROM event_access WHERE user_id = ?').get(u.id).c;
  res.json({
    user: {
      id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
      last_login: u.last_login, created_at: u.created_at, access_count: accessCount,
    },
  });
});

// ── Restaurar ─────────────────────────────────────────────────────────────────
router.post('/event/:id/restore', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado na lixeira.' });
  db.prepare('UPDATE events SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(e.id);
  logActivity(who(req), 'restaurou evento da lixeira', e.name);
  res.json({ ok: true });
});

router.post('/participant/:id/restore', (req, res) => {
  const p = db.prepare('SELECT * FROM participants WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado na lixeira.' });
  // Conflito de nome: pode haver outro convidado ATIVO com o mesmo nome neste
  // evento (índice único event_id + name_normalized).
  const clash = db.prepare(
    'SELECT id FROM participants WHERE event_id = ? AND name_normalized = ? AND deleted_at IS NULL AND id <> ?'
  ).get(p.event_id, p.name_normalized, p.id);
  if (clash) return res.status(409).json({ error: 'Já existe um convidado ativo com este nome neste evento. Não é possível restaurar.' });
  db.prepare('UPDATE participants SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(p.id);
  logActivity(who(req), 'restaurou convidado da lixeira', p.name);
  res.json({ ok: true });
});

router.post('/user/:id/restore', (req, res) => {
  const u = db.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado na lixeira.' });
  // Conflito de e-mail: outra conta ATIVA pode ter assumido o e-mail.
  const clash = db.prepare('SELECT id FROM admins WHERE email = ? AND deleted_at IS NULL AND id <> ?').get(u.email, u.id);
  if (clash) return res.status(409).json({ error: 'Já existe uma conta ativa com este e-mail. Não é possível restaurar.' });
  db.prepare('UPDATE admins SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(u.id);
  // Recoloca o e-mail no índice global para o login voltar a funcionar.
  registerAdminEmail(u.email, req.tenantSlug);
  logActivity(who(req), 'restaurou usuário da lixeira', u.name);
  res.json({ ok: true });
});

// ── Excluir permanentemente (irreversível) ────────────────────────────────────
router.delete('/event/:id', (req, res) => {
  const e = db.prepare('SELECT name FROM events WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado na lixeira.' });
  hardDeleteEvent(db, Number(req.params.id));
  logActivity(who(req), 'excluiu evento permanentemente', e.name);
  res.json({ ok: true });
});

router.delete('/participant/:id', (req, res) => {
  const p = db.prepare('SELECT name FROM participants WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Convidado não encontrado na lixeira.' });
  hardDeleteParticipant(db, Number(req.params.id));
  logActivity(who(req), 'excluiu convidado permanentemente', p.name);
  res.json({ ok: true });
});

router.delete('/user/:id', (req, res) => {
  const u = db.prepare('SELECT name FROM admins WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado na lixeira.' });
  hardDeleteAdmin(db, Number(req.params.id));
  logActivity(who(req), 'excluiu usuário permanentemente', u.name);
  res.json({ ok: true });
});

module.exports = router;
