const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, normalizeRole, authorizedEventIds } = require('../utils/permissions');
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

  // O nº de contratações reflete apenas os eventos que o usuário pode ver.
  // Admin (ids === null) enxerga tudo.
  const ids = authorizedEventIds(req.admin);
  let countFilter = '';
  let countParams = [];
  if (ids !== null) {
    if (ids.length === 0) countFilter = 'AND 1=0';
    else { countFilter = `AND c.event_id IN (${ids.map(() => '?').join(',')})`; countParams = ids; }
  }

  const rows = db.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM contracts c WHERE c.supplier_id = s.id ${countFilter}) AS contracts_count
     FROM suppliers s ${where} ORDER BY s.company COLLATE NOCASE`
  ).all(...countParams, ...params);
  res.json(rows);
});

// POST /api/suppliers
router.post('/', requireRole('admin', 'gestor'), (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'O nome da empresa é obrigatório.' });
  const category = CATEGORIES.includes(b.category) ? b.category : null;

  const info = db.prepare(
    'INSERT INTO suppliers (company, contact, whatsapp, email, city, state, category, notes, website, instagram, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    String(b.company).trim(),
    b.contact   ? String(b.contact).trim()   : null,
    b.whatsapp  ? String(b.whatsapp).trim()  : null,
    b.email     ? String(b.email).trim()     : null,
    b.city      ? String(b.city).trim()      : null,
    b.state     ? String(b.state).trim()     : null,
    category,
    b.notes     ? String(b.notes).trim()     : null,
    b.website   ? String(b.website).trim()   : null,
    b.instagram ? String(b.instagram).trim() : null,
    Number.isInteger(Number(b.rating)) && Number(b.rating) >= 0 && Number(b.rating) <= 5 ? Number(b.rating) : 0
  );

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
  logActivity(req.admin.name || req.admin.email, 'cadastrou fornecedor', supplier.company);
  res.status(201).json(supplier);
});

// GET /api/suppliers/:id
router.get('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Fornecedor não encontrado.' });

  // Contratos visíveis ao usuário: admin vê todos; demais só de eventos autorizados.
  const ids = authorizedEventIds(req.admin);
  let contracts;
  if (ids === null) {
    contracts = db.prepare(
      `SELECT c.*, e.name AS event_name, e.event_date
       FROM contracts c JOIN events e ON e.id = c.event_id
       WHERE c.supplier_id = ? ORDER BY e.event_date DESC`
    ).all(s.id);
  } else if (ids.length === 0) {
    contracts = [];
  } else {
    contracts = db.prepare(
      `SELECT c.*, e.name AS event_name, e.event_date
       FROM contracts c JOIN events e ON e.id = c.event_id
       WHERE c.supplier_id = ? AND c.event_id IN (${ids.map(() => '?').join(',')})
       ORDER BY e.event_date DESC`
    ).all(s.id, ...ids);
  }

  // Estatísticas derivadas dos contratos já filtrados (ordenados por data DESC).
  const values = contracts.map((c) => c.value).filter((v) => v != null);
  const stats = {
    contracts_count: contracts.length,
    avg_value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    last_event_name: contracts.length ? contracts[0].event_name : null,
  };

  res.json({ supplier: s, contracts, stats });
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

  const rating = b.rating != null
    ? (Number.isInteger(Number(b.rating)) && Number(b.rating) >= 0 && Number(b.rating) <= 5 ? Number(b.rating) : s.rating)
    : s.rating;

  db.prepare(
    'UPDATE suppliers SET company=?, contact=?, whatsapp=?, email=?, city=?, state=?, category=?, notes=?, website=?, instagram=?, rating=? WHERE id=?'
  ).run(
    company,
    b.contact   != null ? (String(b.contact).trim()   || null) : s.contact,
    b.whatsapp  != null ? (String(b.whatsapp).trim()  || null) : s.whatsapp,
    b.email     != null ? (String(b.email).trim()     || null) : s.email,
    b.city      != null ? (String(b.city).trim()      || null) : s.city,
    b.state     != null ? (String(b.state).trim()     || null) : s.state,
    category,
    b.notes     != null ? (String(b.notes).trim()     || null) : s.notes,
    b.website   != null ? (String(b.website).trim()   || null) : s.website,
    b.instagram != null ? (String(b.instagram).trim() || null) : s.instagram,
    rating,
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
