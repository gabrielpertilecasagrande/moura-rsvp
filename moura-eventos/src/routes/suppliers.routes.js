const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, normalizeRole } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = [
  'Sonorização', 'Iluminação', 'LED', 'Streaming', 'Fotografia', 'Filmagem',
  'Buffet', 'Decoração', 'Cerimonial', 'Segurança', 'Recepção', 'Brindes',
  'Transporte', 'Hospedagem',
];

// GET /api/suppliers
router.get('/', (req, res) => {
  const { q, category } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (q) {
    where += ' AND (company LIKE ? OR contact LIKE ? OR city LIKE ? OR category LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  const rows = db.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM contracts c WHERE c.supplier_id = s.id) AS contracts_count
     FROM suppliers s ${where} ORDER BY s.company COLLATE NOCASE`
  ).all(...params);
  res.json(rows);
});

// POST /api/suppliers
router.post('/', requireRole('admin', 'gestor'), (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'O nome da empresa é obrigatório.' });
  const category = CATEGORIES.includes(b.category) ? b.category : null;

  const info = db.prepare(
    'INSERT INTO suppliers (company, contact, whatsapp, email, city, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    String(b.company).trim(),
    b.contact  ? String(b.contact).trim()  : null,
    b.whatsapp ? String(b.whatsapp).trim() : null,
    b.email    ? String(b.email).trim()    : null,
    b.city     ? String(b.city).trim()     : null,
    category,
    b.notes    ? String(b.notes).trim()    : null
  );

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
  logActivity(req.admin.name || req.admin.email, 'cadastrou fornecedor', supplier.company);
  res.status(201).json(supplier);
});

// GET /api/suppliers/:id
router.get('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

  const contracts = db.prepare(
    `SELECT c.*, e.name AS event_name, e.event_date
     FROM contracts c JOIN events e ON e.id = c.event_id
     WHERE c.supplier_id = ? ORDER BY e.event_date DESC`
  ).all(s.id);

  res.json({ supplier: s, contracts });
});

// PUT /api/suppliers/:id
router.put('/:id', requireRole('admin', 'gestor'), (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

  const b = req.body || {};
  const company = b.company != null ? String(b.company).trim() : s.company;
  if (!company) return res.status(400).json({ error: 'O nome da empresa é obrigatório.' });
  const category = b.category != null ? (CATEGORIES.includes(b.category) ? b.category : null) : s.category;

  db.prepare(
    'UPDATE suppliers SET company=?, contact=?, whatsapp=?, email=?, city=?, category=?, notes=? WHERE id=?'
  ).run(
    company,
    b.contact  != null ? (String(b.contact).trim()  || null) : s.contact,
    b.whatsapp != null ? (String(b.whatsapp).trim() || null) : s.whatsapp,
    b.email    != null ? (String(b.email).trim()    || null) : s.email,
    b.city     != null ? (String(b.city).trim()     || null) : s.city,
    category,
    b.notes    != null ? (String(b.notes).trim()    || null) : s.notes,
    id
  );

  logActivity(req.admin.name || req.admin.email, 'editou fornecedor', company);
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
});

// DELETE /api/suppliers/:id
router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

  const inUse = db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE supplier_id = ?').get(id).n;
  if (inUse > 0) {
    return res.status(409).json({ error: 'Este fornecedor possui contratações. Remova-as antes de excluir.' });
  }

  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  logActivity(req.admin.name || req.admin.email, 'excluiu fornecedor', s.company);
  res.json({ ok: true });
});

module.exports = router;
