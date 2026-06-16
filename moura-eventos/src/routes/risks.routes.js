const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const IMPACTS       = ['Alto', 'Médio', 'Baixo'];
const PROBABILITIES = ['Alta', 'Média', 'Baixa'];
const STATUSES      = ['Ativo', 'Mitigado', 'Encerrado'];

// GET /api/events/:id/risks
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM event_risks WHERE event_id = ? ORDER BY created_at DESC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/risks
router.post('/', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ error: 'Informe a descrição do risco.' });

  const info = db.prepare(
    `INSERT INTO event_risks (event_id, description, impact, probability, action_plan, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    String(b.description).trim(),
    IMPACTS.includes(b.impact)             ? b.impact       : 'Médio',
    PROBABILITIES.includes(b.probability)  ? b.probability  : 'Média',
    b.action_plan ? String(b.action_plan).trim() : null,
    STATUSES.includes(b.status)            ? b.status       : 'Ativo'
  );
  touchEvent(eventId);
  res.status(201).json(db.prepare('SELECT * FROM event_risks WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/risks/:rid
router.put('/:rid', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const rid     = Number(req.params.rid);
  const row = db.prepare('SELECT * FROM event_risks WHERE id = ? AND event_id = ?').get(rid, eventId);
  if (!row) return res.status(404).json({ error: 'Risco não encontrado.' });

  const b = req.body || {};
  db.prepare(
    `UPDATE event_risks SET description=?, impact=?, probability=?, action_plan=?, status=? WHERE id=?`
  ).run(
    b.description ? String(b.description).trim() : row.description,
    IMPACTS.includes(b.impact)            ? b.impact       : row.impact,
    PROBABILITIES.includes(b.probability) ? b.probability  : row.probability,
    b.action_plan != null ? (String(b.action_plan).trim() || null) : row.action_plan,
    STATUSES.includes(b.status)           ? b.status       : row.status,
    rid
  );
  touchEvent(eventId);
  res.json(db.prepare('SELECT * FROM event_risks WHERE id = ?').get(rid));
});

// DELETE /api/events/:id/risks/:rid
router.delete('/:rid', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const rid     = Number(req.params.rid);
  const row = db.prepare('SELECT id FROM event_risks WHERE id = ? AND event_id = ?').get(rid, eventId);
  if (!row) return res.status(404).json({ error: 'Risco não encontrado.' });
  db.prepare('DELETE FROM event_risks WHERE id = ?').run(rid);
  touchEvent(eventId);
  res.json({ ok: true });
});

module.exports = router;
