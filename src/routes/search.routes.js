const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/search?q=  — busca global por eventos e participantes (nome, e-mail, telefone)
// Restrita aos eventos que o usuário pode visualizar.
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ events: [], participants: [] });
  const like = `%${q}%`;

  const ids = authorizedEventIds(req.admin); // null = admin (todos)
  let evScope = '';
  let pScope = '';
  let scopeParams = [];
  if (ids !== null) {
    if (!ids.length) return res.json({ events: [], participants: [] });
    const ph = ids.map(() => '?').join(',');
    evScope = ` AND id IN (${ph})`;
    pScope = ` AND p.event_id IN (${ph})`;
    scopeParams = ids;
  }

  const events = db.prepare(
    `SELECT id, slug, name, event_date, location FROM events WHERE deleted_at IS NULL AND (name LIKE ? OR location LIKE ?)${evScope} ORDER BY created_at DESC LIMIT 10`
  ).all(like, like, ...scopeParams);

  const participants = db.prepare(`
    SELECT p.id, p.name, p.email, p.phone, p.response, p.event_id, e.name AS event_name
    FROM participants p JOIN events e ON e.id = p.event_id
    WHERE p.deleted_at IS NULL AND e.deleted_at IS NULL AND (p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)${pScope}
    ORDER BY p.updated_at DESC LIMIT 20
  `).all(like, like, like, ...scopeParams);

  res.json({ events, participants });
});

module.exports = router;
