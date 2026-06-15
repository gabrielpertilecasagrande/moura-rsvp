const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const CONTRACT_STATUS  = ['Em negociação', 'Aprovado', 'Recusado', 'Cancelado'];
const PAYMENT_STATUS   = ['Pendente', 'Parcial', 'Pago'];

function getEvent(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
}

// GET /api/events/:id/contracts
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    `SELECT c.*, s.company, s.category, s.whatsapp, s.email
     FROM contracts c JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.event_id = ? ORDER BY c.created_at DESC`
  ).all(Number(req.params.id));
  const total = rows.reduce((s, c) => s + (c.value || 0), 0);
  res.json({ contracts: rows, total });
});

// POST /api/events/:id/contracts
router.post('/', requirePerm('can_contracts'), (req, res) => {
  const eventId = Number(req.params.id);
  if (!getEvent(eventId)) return res.status(404).json({ error: 'Evento não encontrado.' });

  const b = req.body || {};
  if (!b.supplier_id) return res.status(400).json({ error: 'Selecione um fornecedor.' });

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(b.supplier_id));
  if (!supplier) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

  const status  = CONTRACT_STATUS.includes(b.status)   ? b.status  : 'Em negociação';
  const payment = PAYMENT_STATUS.includes(b.payment_status) ? b.payment_status : 'Pendente';

  const info = db.prepare(
    `INSERT INTO contracts (event_id, supplier_id, value, status, payment_status, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    supplier.id,
    b.value != null ? Number(b.value) : null,
    status,
    payment,
    b.notes ? String(b.notes).trim() : null
  );

  const contract = db.prepare(
    `SELECT c.*, s.company, s.category FROM contracts c JOIN suppliers s ON s.id = c.supplier_id WHERE c.id = ?`
  ).get(info.lastInsertRowid);

  const ev = getEvent(eventId);
  logActivity(req.admin.name || req.admin.email, 'adicionou contratação', `${ev.name} ← ${supplier.company}`);
  res.status(201).json(contract);
});

// PUT /api/events/:id/contracts/:cid
router.put('/:cid', requirePerm('can_contracts'), (req, res) => {
  const eventId = Number(req.params.id);
  const cid     = Number(req.params.cid);
  const c = db.prepare('SELECT * FROM contracts WHERE id = ? AND event_id = ?').get(cid, eventId);
  if (!c) return res.status(404).json({ error: 'Contratação não encontrada.' });

  const b = req.body || {};
  const status  = CONTRACT_STATUS.includes(b.status)       ? b.status         : c.status;
  const payment = PAYMENT_STATUS.includes(b.payment_status) ? b.payment_status : c.payment_status;
  const value   = b.value != null ? Number(b.value) : c.value;
  const notes   = b.notes != null ? (String(b.notes).trim() || null) : c.notes;

  db.prepare(
    `UPDATE contracts SET value=?, status=?, payment_status=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(value, status, payment, notes, cid);

  const updated = db.prepare(
    `SELECT c.*, s.company, s.category FROM contracts c JOIN suppliers s ON s.id = c.supplier_id WHERE c.id = ?`
  ).get(cid);
  res.json(updated);
});

// DELETE /api/events/:id/contracts/:cid
router.delete('/:cid', requirePerm('can_contracts'), (req, res) => {
  const eventId = Number(req.params.id);
  const cid     = Number(req.params.cid);
  const c = db.prepare('SELECT * FROM contracts WHERE id = ? AND event_id = ?').get(cid, eventId);
  if (!c) return res.status(404).json({ error: 'Contratação não encontrada.' });
  db.prepare('DELETE FROM contracts WHERE id = ?').run(cid);
  const supplier = db.prepare('SELECT company FROM suppliers WHERE id = ?').get(c.supplier_id);
  const ev = getEvent(eventId);
  logActivity(req.admin.name || req.admin.email, 'removeu contratação', `${ev?.name} ← ${supplier?.company}`);
  res.json({ ok: true });
});

module.exports = router;
