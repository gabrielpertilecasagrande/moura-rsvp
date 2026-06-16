const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const TASK_STATUS   = ['Pendente', 'Em andamento', 'Concluído'];
const TASK_PRIORITY = ['Baixa', 'Média', 'Alta', 'Crítica'];

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
    `INSERT INTO checklist (event_id, title, responsible, due_date, status, priority)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    String(b.title).trim(),
    b.responsible ? String(b.responsible).trim() : null,
    b.due_date    || null,
    TASK_STATUS.includes(b.status)     ? b.status   : 'Pendente',
    TASK_PRIORITY.includes(b.priority) ? b.priority : 'Média'
  );

  touchEvent(eventId);
  res.status(201).json(db.prepare('SELECT * FROM checklist WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/events/:id/checklist/:tid
router.put('/:tid', requirePerm('can_checklist'), (req, res) => {
  const eventId = Number(req.params.id);
  const tid     = Number(req.params.tid);
  const task = db.prepare('SELECT * FROM checklist WHERE id = ? AND event_id = ?').get(tid, eventId);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

  const b = req.body || {};
  const title       = b.title       != null ? String(b.title).trim()        : task.title;
  const responsible = b.responsible != null ? (String(b.responsible).trim() || null) : task.responsible;
  const due_date    = b.due_date    != null ? (b.due_date || null)           : task.due_date;
  const status      = TASK_STATUS.includes(b.status)     ? b.status          : task.status;
  const priority    = TASK_PRIORITY.includes(b.priority) ? b.priority        : task.priority;

  if (!title) return res.status(400).json({ error: 'Informe o título da tarefa.' });

  db.prepare(
    `UPDATE checklist SET title=?, responsible=?, due_date=?, status=?, priority=?, updated_at=datetime('now') WHERE id=?`
  ).run(title, responsible, due_date, status, priority, tid);

  touchEvent(eventId);
  res.json(db.prepare('SELECT * FROM checklist WHERE id = ?').get(tid));
});

// DELETE /api/events/:id/checklist/:tid
router.delete('/:tid', requirePerm('can_checklist'), (req, res) => {
  const eventId = Number(req.params.id);
  const tid     = Number(req.params.tid);
  const task = db.prepare('SELECT * FROM checklist WHERE id = ? AND event_id = ?').get(tid, eventId);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  db.prepare('DELETE FROM checklist WHERE id = ?').run(tid);
  touchEvent(eventId);
  res.json({ ok: true });
});

// GET /api/events/:id/checklist/:tid/comments
router.get('/:tid/comments', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM checklist_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(Number(req.params.tid));
  res.json(rows);
});

// POST /api/events/:id/checklist/:tid/comments
router.post('/:tid/comments', requirePerm('can_checklist'), (req, res) => {
  const tid = Number(req.params.tid);
  const b = req.body || {};
  if (!b.comment) return res.status(400).json({ error: 'Informe o comentário.' });
  const info = db.prepare(
    `INSERT INTO checklist_comments (task_id, author, comment) VALUES (?, ?, ?)`
  ).run(tid, req.admin.name || req.admin.email, String(b.comment).trim());
  touchEvent(Number(req.params.id));
  res.status(201).json(db.prepare('SELECT * FROM checklist_comments WHERE id = ?').get(info.lastInsertRowid));
});

// DELETE /api/events/:id/checklist/:tid/comments/:cid
router.delete('/:tid/comments/:cid', requirePerm('can_checklist'), (req, res) => {
  db.prepare('DELETE FROM checklist_comments WHERE id = ?').run(Number(req.params.cid));
  res.json({ ok: true });
});

module.exports = router;
