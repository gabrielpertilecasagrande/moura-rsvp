const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const TYPES    = ['Fornecedor', 'Orçamento', 'Mudança', 'Outro'];
const STATUSES = ['Pendente', 'Aprovado', 'Rejeitado'];

// GET /api/events/:id/approvals
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM event_approvals WHERE event_id = ? ORDER BY created_at DESC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/approvals
router.post('/', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Informe o título.' });

  const info = db.prepare(
    `INSERT INTO event_approvals (event_id, title, type, status, description, approved_by, approved_at, observation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    String(b.title).trim(),
    TYPES.includes(b.type) ? b.type : 'Outro',
    STATUSES.includes(b.status) ? b.status : 'Pendente',
    b.description ? String(b.description).trim() : null,
    b.approved_by ? String(b.approved_by).trim() : null,
    b.approved_at || null,
    b.observation ? String(b.observation).trim() : null
  );
  touchEvent(eventId);
  res.status(201).json(db.prepare('SELECT * FROM event_approvals WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/approvals/:aid
router.put('/:aid', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const aid     = Number(req.params.aid);
  const row = db.prepare('SELECT * FROM event_approvals WHERE id = ? AND event_id = ?').get(aid, eventId);
  if (!row) return res.status(404).json({ error: 'Aprovação não encontrada.' });

  const b = req.body || {};
  db.prepare(
    `UPDATE event_approvals SET
      title=?, type=?, status=?, description=?, approved_by=?, approved_at=?, observation=?
     WHERE id=?`
  ).run(
    b.title       ? String(b.title).trim()       : row.title,
    TYPES.includes(b.type)       ? b.type        : row.type,
    STATUSES.includes(b.status)  ? b.status      : row.status,
    b.description != null ? (String(b.description).trim() || null) : row.description,
    b.approved_by != null ? (String(b.approved_by).trim() || null) : row.approved_by,
    b.approved_at != null ? (b.approved_at || null) : row.approved_at,
    b.observation != null ? (String(b.observation).trim() || null) : row.observation,
    aid
  );
  touchEvent(eventId);
  res.json(db.prepare('SELECT * FROM event_approvals WHERE id = ?').get(aid));
});

// DELETE /api/events/:id/approvals/:aid
router.delete('/:aid', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const aid     = Number(req.params.aid);
  const row = db.prepare('SELECT id FROM event_approvals WHERE id = ? AND event_id = ?').get(aid, eventId);
  if (!row) return res.status(404).json({ error: 'Aprovação não encontrada.' });
  db.prepare('DELETE FROM event_approvals WHERE id = ?').run(aid);
  touchEvent(eventId);
  res.json({ ok: true });
});

module.exports = router;
