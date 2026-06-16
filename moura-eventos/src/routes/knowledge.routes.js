const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['Processos', 'Modelos e templates', 'Fornecedores', 'Boas práticas', 'Jurídico / Contratos', 'Outros'];

// GET /api/knowledge?q=&category=
router.get('/', (req, res) => {
  const q    = (req.query.q    || '').trim().toLowerCase();
  const cat  = (req.query.category || '').trim();
  let rows = db.prepare(
    'SELECT id, title, category, tags, author, created_at, updated_at, substr(content, 1, 200) AS excerpt FROM knowledge_articles ORDER BY updated_at DESC'
  ).all();
  if (cat)  rows = rows.filter((r) => r.category === cat);
  if (q)    rows = rows.filter((r) => (r.title + ' ' + (r.tags || '') + ' ' + (r.excerpt || '')).toLowerCase().includes(q));
  res.json(rows);
});

// GET /api/knowledge/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM knowledge_articles WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Artigo não encontrado.' });
  res.json(row);
});

// POST /api/knowledge
router.post('/', requireRole('admin', 'gestor'), (req, res) => {
  const b = req.body || {};
  if (!b.title)   return res.status(400).json({ error: 'Informe o título.' });
  if (!b.content) return res.status(400).json({ error: 'Informe o conteúdo.' });

  const info = db.prepare(
    `INSERT INTO knowledge_articles (title, category, content, tags, author)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    String(b.title).trim(),
    CATEGORIES.includes(b.category) ? b.category : 'Outros',
    String(b.content).trim(),
    b.tags ? String(b.tags).trim() : null,
    req.admin.name || req.admin.email
  );
  res.status(201).json(db.prepare('SELECT * FROM knowledge_articles WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/knowledge/:id
router.put('/:id', requireRole('admin', 'gestor'), (req, res) => {
  const id  = Number(req.params.id);
  const row = db.prepare('SELECT * FROM knowledge_articles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Artigo não encontrado.' });

  const b = req.body || {};
  db.prepare(
    `UPDATE knowledge_articles SET title=?, category=?, content=?, tags=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    b.title   ? String(b.title).trim()   : row.title,
    CATEGORIES.includes(b.category) ? b.category : row.category,
    b.content ? String(b.content).trim() : row.content,
    b.tags    != null ? (String(b.tags).trim() || null) : row.tags,
    id
  );
  res.json(db.prepare('SELECT * FROM knowledge_articles WHERE id = ?').get(id));
});

// DELETE /api/knowledge/:id
router.delete('/:id', requireRole('admin', 'gestor'), (req, res) => {
  const id  = Number(req.params.id);
  const row = db.prepare('SELECT id FROM knowledge_articles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Artigo não encontrado.' });
  db.prepare('DELETE FROM knowledge_articles WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
