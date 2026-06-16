const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/events/:id/relations — eventos vinculados (em qualquer direção)
router.get('/', requirePerm('can_view'), (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare(`
    SELECT e.id, e.name, e.client, e.event_date, e.status, e.event_type
    FROM event_relations r
    JOIN events e ON e.id = CASE WHEN r.event_id = ? THEN r.related_event_id ELSE r.event_id END
    WHERE r.event_id = ? OR r.related_event_id = ?
    ORDER BY e.event_date DESC, e.created_at DESC
  `).all(id, id, id);
  res.json(rows);
});

// POST /api/events/:id/relations — vincula a outro evento
router.post('/', requirePerm('can_edit'), (req, res) => {
  const id    = Number(req.params.id);
  const relId = Number((req.body || {}).related_event_id);
  if (!relId || relId === id) return res.status(400).json({ error: 'Selecione um evento válido.' });

  const target = db.prepare('SELECT id FROM events WHERE id = ?').get(relId);
  if (!target) return res.status(404).json({ error: 'Evento não encontrado.' });

  const exists = db.prepare(
    'SELECT id FROM event_relations WHERE (event_id=? AND related_event_id=?) OR (event_id=? AND related_event_id=?)'
  ).get(id, relId, relId, id);
  if (!exists) {
    db.prepare('INSERT INTO event_relations (event_id, related_event_id) VALUES (?, ?)').run(id, relId);
    touchEvent(id);
    touchEvent(relId);
  }
  res.status(201).json({ ok: true });
});

// DELETE /api/events/:id/relations/:rid — desfaz o vínculo
router.delete('/:rid', requirePerm('can_edit'), (req, res) => {
  const id  = Number(req.params.id);
  const rid = Number(req.params.rid);
  db.prepare(
    'DELETE FROM event_relations WHERE (event_id=? AND related_event_id=?) OR (event_id=? AND related_event_id=?)'
  ).run(id, rid, rid, id);
  touchEvent(id);
  res.json({ ok: true });
});

module.exports = router;
