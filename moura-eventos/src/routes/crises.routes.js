const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const IMPACTS  = ['Alto', 'Médio', 'Baixo'];
const STATUSES = ['Aberta', 'Em tratamento', 'Resolvida'];

// GET /api/events/:id/crises
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM event_crises WHERE event_id = ? ORDER BY occurred_at DESC, created_at DESC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/crises
router.post('/', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ error: 'Informe a descrição da ocorrência.' });

  const info = db.prepare(
    `INSERT INTO event_crises (event_id, occurred_at, description, impact, action_taken, responsible, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    b.occurred_at   || null,
    String(b.description).trim(),
    IMPACTS.includes(b.impact)   ? b.impact  : 'Médio',
    b.action_taken  ? String(b.action_taken).trim()  : null,
    b.responsible   ? String(b.responsible).trim()   : null,
    STATUSES.includes(b.status)  ? b.status  : 'Aberta'
  );
  touchEvent(eventId);
  res.status(201).json(db.prepare('SELECT * FROM event_crises WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/crises/:cid
router.put('/:cid', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const cid     = Number(req.params.cid);
  const row = db.prepare('SELECT * FROM event_crises WHERE id = ? AND event_id = ?').get(cid, eventId);
  if (!row) return res.status(404).json({ error: 'Ocorrência não encontrada.' });

  const b = req.body || {};
  db.prepare(
    `UPDATE event_crises SET occurred_at=?, description=?, impact=?, action_taken=?, responsible=?, status=? WHERE id=?`
  ).run(
    b.occurred_at  != null ? (b.occurred_at || null)                  : row.occurred_at,
    b.description  ? String(b.description).trim()                     : row.description,
    IMPACTS.includes(b.impact)  ? b.impact                            : row.impact,
    b.action_taken != null ? (String(b.action_taken).trim() || null)  : row.action_taken,
    b.responsible  != null ? (String(b.responsible).trim() || null)   : row.responsible,
    STATUSES.includes(b.status) ? b.status                            : row.status,
    cid
  );
  touchEvent(eventId);
  res.json(db.prepare('SELECT * FROM event_crises WHERE id = ?').get(cid));
});

// DELETE /api/events/:id/crises/:cid
router.delete('/:cid', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const cid     = Number(req.params.cid);
  const row = db.prepare('SELECT id FROM event_crises WHERE id = ? AND event_id = ?').get(cid, eventId);
  if (!row) return res.status(404).json({ error: 'Ocorrência não encontrada.' });
  db.prepare('DELETE FROM event_crises WHERE id = ?').run(cid);
  touchEvent(eventId);
  res.json({ ok: true });
});

module.exports = router;
