const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const TASK_STATUS = ['Pendente', 'Em andamento', 'Concluído'];

// GET /api/events/:id/checklist
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM checklist WHERE event_id = ? ORDER BY due_date ASC, created_at ASC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/checklist
router.post('/', requirePerm('can_checklist'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Informe o título da tarefa.' });

  const info = db.prepare(
    `INSERT INTO checklist (event_id, title, responsible, due_date, status)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    eventId,
    String(b.title).trim(),
    b.responsible ? String(b.responsible).trim() : null,
    b.due_date    || null,
    TASK_STATUS.includes(b.status) ? b.status : 'Pendente'
  );

  res.status(201).json(db.prepare('SELECT * FROM checklist WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/checklist/:tid
router.put('/:tid', requirePerm('can_checklist'), (req, res) => {
  const eventId = Number(req.params.id);
  const tid     = Number(req.params.tid);
  const task = db.prepare('SELECT * FROM checklist WHERE id = ? AND event_id = ?').get(tid, eventId);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

  const b = req.body || {};
  const title       = b.title       != null ? String(b.title).trim()       : task.title;
  const responsible = b.responsible != null ? (String(b.responsible).trim() || null) : task.responsible;
  const due_date    = b.due_date    != null ? (b.due_date || null)          : task.due_date;
  const status      = TASK_STATUS.includes(b.status) ? b.status             : task.status;

  if (!title) return res.status(400).json({ error: 'Informe o título da tarefa.' });

  db.prepare(
    `UPDATE checklist SET title=?, responsible=?, due_date=?, status=?, updated_at=datetime('now') WHERE id=?`
  ).run(title, responsible, due_date, status, tid);

  res.json(db.prepare('SELECT * FROM checklist WHERE id = ?').get(tid));
});

// DELETE /api/events/:id/checklist/:tid
router.delete('/:tid', requirePerm('can_checklist'), (req, res) => {
  const eventId = Number(req.params.id);
  const tid     = Number(req.params.tid);
  const task = db.prepare('SELECT * FROM checklist WHERE id = ? AND event_id = ?').get(tid, eventId);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  db.prepare('DELETE FROM checklist WHERE id = ?').run(tid);
  res.json({ ok: true });
});

module.exports = router;
