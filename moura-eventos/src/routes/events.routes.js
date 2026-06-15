const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePerm, authorizedEventIds, grantFullAccess, normalizeRole } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(requireAuth);

const EVENT_STATUS = ['Planejamento', 'Contratação', 'Produção', 'Evento realizado', 'Encerrado'];

// GET /api/events
router.get('/', (req, res) => {
  const isAdmin = normalizeRole(req.admin.role) === 'admin';
  const ids = authorizedEventIds(req.admin);

  let where = 'WHERE 1=1';
  const params = [];

  if (!isAdmin && ids !== null) {
    if (ids.length === 0) return res.json([]);
    where += ` AND e.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }

  const { q, status } = req.query;
  if (q) {
    where += ' AND (e.name LIKE ? OR e.client LIKE ? OR e.city LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (status) {
    where += ' AND e.status = ?';
    params.push(status);
  }

  const events = db.prepare(
    `SELECT e.*,
       (SELECT COUNT(*) FROM contracts c WHERE c.event_id = e.id) AS contracts_count,
       (SELECT COUNT(*) FROM checklist ch WHERE ch.event_id = e.id AND ch.status != 'Concluído') AS open_tasks
     FROM events e
     ${where}
     ORDER BY e.event_date DESC, e.created_at DESC`
  ).all(...params);

  res.json(events);
});

// POST /api/events
router.post('/', requireRole('admin', 'gestor'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });
  const status = EVENT_STATUS.includes(b.status) ? b.status : 'Planejamento';

  const info = db.prepare(
    `INSERT INTO events (name, client, event_date, event_time, location, city, responsible, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(b.name).trim(),
    b.client   ? String(b.client).trim()   : null,
    b.event_date   || null,
    b.event_time   || null,
    b.location ? String(b.location).trim() : null,
    b.city     ? String(b.city).trim()     : null,
    b.responsible ? String(b.responsible).trim() : null,
    status
  );

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  if (normalizeRole(req.admin.role) !== 'admin') {
    grantFullAccess(req.admin.id, event.id);
  }
  logActivity(req.admin.name || req.admin.email, 'criou evento', event.name);
  res.status(201).json(event);
});

// GET /api/events/:id
router.get('/:id', requirePerm('can_view'), (req, res) => {
  const id = Number(req.params.id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) return res.status(404).json({ error: 'Evento não encontrado.' });

  const contracts = db.prepare(
    `SELECT c.*, s.company, s.category, s.whatsapp, s.email
     FROM contracts c JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.event_id = ? ORDER BY c.created_at DESC`
  ).all(id);

  const checklist = db.prepare(
    'SELECT * FROM checklist WHERE event_id = ? ORDER BY due_date ASC, created_at ASC'
  ).all(id);

  const files = db.prepare(
    'SELECT id, filename, mime_type, size, uploaded_by, created_at FROM event_files WHERE event_id = ? ORDER BY created_at DESC'
  ).all(id);

  const diary = db.prepare(
    'SELECT * FROM diary WHERE event_id = ? ORDER BY created_at DESC'
  ).all(id);

  const totalValue = contracts.reduce((s, c) => s + (c.value || 0), 0);

  res.json({ event, contracts, checklist, files, diary, totalValue });
});

// PUT /api/events/:id
router.put('/:id', requirePerm('can_edit'), (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : ev.name;
  if (!name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });
  const status = EVENT_STATUS.includes(b.status) ? b.status : ev.status;

  db.prepare(
    `UPDATE events SET name=?, client=?, event_date=?, event_time=?, location=?, city=?, responsible=?, status=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    name,
    b.client      != null ? (String(b.client).trim()      || null) : ev.client,
    b.event_date  != null ? (b.event_date                 || null) : ev.event_date,
    b.event_time  != null ? (b.event_time                 || null) : ev.event_time,
    b.location    != null ? (String(b.location).trim()    || null) : ev.location,
    b.city        != null ? (String(b.city).trim()        || null) : ev.city,
    b.responsible != null ? (String(b.responsible).trim() || null) : ev.responsible,
    status,
    id
  );

  logActivity(req.admin.name || req.admin.email, 'editou evento', name);
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(id));
});

// DELETE /api/events/:id
router.delete('/:id', requirePerm('can_delete'), (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT name FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  logActivity(req.admin.name || req.admin.email, 'excluiu evento', ev.name);
  res.json({ ok: true });
});

module.exports = router;
