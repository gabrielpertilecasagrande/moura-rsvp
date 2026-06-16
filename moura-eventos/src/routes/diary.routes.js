const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/events/:id/diary
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM diary WHERE event_id = ? ORDER BY created_at DESC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/diary
router.post('/', requirePerm('can_diary'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};
  if (!b.entry || !String(b.entry).trim()) {
    return res.status(400).json({ error: 'O registro não pode estar vazio.' });
  }
  const info = db.prepare(
    'INSERT INTO diary (event_id, entry, author) VALUES (?, ?, ?)'
  ).run(eventId, String(b.entry).trim(), req.admin.name || req.admin.email);
  touchEvent(eventId);
  res.status(201).json(db.prepare('SELECT * FROM diary WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/diary/:did — edita um registro
router.put('/:did', requirePerm('can_diary'), (req, res) => {
  const eventId = Number(req.params.id);
  const did     = Number(req.params.did);
  const entry = db.prepare('SELECT * FROM diary WHERE id = ? AND event_id = ?').get(did, eventId);
  if (!entry) return res.status(404).json({ error: 'Registro não encontrado.' });
  const b = req.body || {};
  if (!b.entry || !String(b.entry).trim()) return res.status(400).json({ error: 'O registro não pode estar vazio.' });
  db.prepare("UPDATE diary SET entry = ?, updated_at = datetime('now') WHERE id = ?").run(String(b.entry).trim(), did);
  touchEvent(eventId);
  res.json(db.prepare('SELECT * FROM diary WHERE id = ?').get(did));
});

// DELETE /api/events/:id/diary/:did
router.delete('/:did', requirePerm('can_diary'), (req, res) => {
  const eventId = Number(req.params.id);
  const did     = Number(req.params.did);
  const entry = db.prepare('SELECT * FROM diary WHERE id = ? AND event_id = ?').get(did, eventId);
  if (!entry) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.prepare('DELETE FROM diary WHERE id = ?').run(did);
  touchEvent(eventId);
  res.json({ ok: true });
});

module.exports = router;
