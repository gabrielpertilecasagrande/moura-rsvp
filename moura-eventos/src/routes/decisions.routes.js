const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/events/:id/decisions
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM event_decisions WHERE event_id = ? ORDER BY decision_date DESC, created_at DESC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/decisions
router.post('/', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};
  if (!b.decision) return res.status(400).json({ error: 'Informe a decisão.' });

  const info = db.prepare(
    `INSERT INTO event_decisions (event_id, decision_date, decision, reason, approver)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    eventId,
    b.decision_date || null,
    String(b.decision).trim(),
    b.reason   ? String(b.reason).trim()   : null,
    b.approver ? String(b.approver).trim() : null
  );
  touchEvent(eventId);
  res.status(201).json(db.prepare('SELECT * FROM event_decisions WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/decisions/:did
router.put('/:did', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const did     = Number(req.params.did);
  const row = db.prepare('SELECT * FROM event_decisions WHERE id = ? AND event_id = ?').get(did, eventId);
  if (!row) return res.status(404).json({ error: 'Decisão não encontrada.' });

  const b = req.body || {};
  db.prepare(
    `UPDATE event_decisions SET decision_date=?, decision=?, reason=?, approver=? WHERE id=?`
  ).run(
    b.decision_date != null ? (b.decision_date || null)          : row.decision_date,
    b.decision      ? String(b.decision).trim()                  : row.decision,
    b.reason        != null ? (String(b.reason).trim() || null)  : row.reason,
    b.approver      != null ? (String(b.approver).trim() || null): row.approver,
    did
  );
  touchEvent(eventId);
  res.json(db.prepare('SELECT * FROM event_decisions WHERE id = ?').get(did));
});

// DELETE /api/events/:id/decisions/:did
router.delete('/:did', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const did     = Number(req.params.did);
  const row = db.prepare('SELECT id FROM event_decisions WHERE id = ? AND event_id = ?').get(did, eventId);
  if (!row) return res.status(404).json({ error: 'Decisão não encontrada.' });
  db.prepare('DELETE FROM event_decisions WHERE id = ?').run(did);
  touchEvent(eventId);
  res.json({ ok: true });
});

module.exports = router;
