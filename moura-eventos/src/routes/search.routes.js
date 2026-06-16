const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/search?q=  — busca global do sistema
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ events: [], suppliers: [], tasks: [], files: [], diary: [] });
  const like = `%${q}%`;

  const ids = authorizedEventIds(req.admin); // null = admin (vê tudo)
  // Cláusula reutilizável para limitar a eventos autorizados.
  let evFilter = '';            // p/ coluna "event_id"
  let evFilterId = '';          // p/ coluna "id" (tabela events)
  let evParams = [];
  if (ids !== null) {
    if (ids.length === 0) { evFilter = 'AND 1=0'; evFilterId = 'AND 1=0'; }
    else {
      const ph = ids.map(() => '?').join(',');
      evFilter = `AND event_id IN (${ph})`;
      evFilterId = `AND id IN (${ph})`;
      evParams = ids;
    }
  }

  const events = db.prepare(
    `SELECT id, name, client, city, event_date, status FROM events
     WHERE (name LIKE ? OR client LIKE ? OR city LIKE ? OR location LIKE ? OR responsible LIKE ?)
     ${evFilterId} ORDER BY event_date DESC LIMIT 8`
  ).all(like, like, like, like, like, ...evParams);

  // Fornecedores são um diretório global (visível a todos os autenticados).
  const suppliers = db.prepare(
    `SELECT id, company, category, city FROM suppliers
     WHERE company LIKE ? OR contact LIKE ? OR city LIKE ? OR category LIKE ?
     ORDER BY company COLLATE NOCASE LIMIT 8`
  ).all(like, like, like, like);

  const tasks = db.prepare(
    `SELECT c.id, c.title, c.responsible, c.status, c.event_id, e.name AS event_name
     FROM checklist c JOIN events e ON e.id = c.event_id
     WHERE (c.title LIKE ? OR c.responsible LIKE ?) ${evFilter ? evFilter.replace('event_id', 'c.event_id') : ''}
     ORDER BY c.created_at DESC LIMIT 8`
  ).all(like, like, ...evParams);

  const files = db.prepare(
    `SELECT f.id, f.filename, f.category, f.event_id, e.name AS event_name
     FROM event_files f JOIN events e ON e.id = f.event_id
     WHERE f.filename LIKE ? ${evFilter ? evFilter.replace('event_id', 'f.event_id') : ''}
     ORDER BY f.created_at DESC LIMIT 8`
  ).all(like, ...evParams);

  const diary = db.prepare(
    `SELECT d.id, d.entry, d.author, d.event_id, e.name AS event_name
     FROM diary d JOIN events e ON e.id = d.event_id
     WHERE d.entry LIKE ? ${evFilter ? evFilter.replace('event_id', 'd.event_id') : ''}
     ORDER BY d.created_at DESC LIMIT 6`
  ).all(like, ...evParams);

  res.json({ events, suppliers, tasks, files, diary });
});

module.exports = router;
