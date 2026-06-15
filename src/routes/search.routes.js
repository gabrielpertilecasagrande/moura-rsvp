const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/search?q=  — busca global por eventos e participantes (nome, e-mail, telefone)
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ events: [], participants: [] });
  const like = `%${q}%`;

  const events = db.prepare(
    'SELECT id, slug, name, event_date, location FROM events WHERE name LIKE ? OR location LIKE ? ORDER BY created_at DESC LIMIT 10'
  ).all(like, like);

  const participants = db.prepare(`
    SELECT p.id, p.name, p.email, p.phone, p.response, p.event_id, e.name AS event_name
    FROM participants p JOIN events e ON e.id = p.event_id
    WHERE p.name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?
    ORDER BY p.updated_at DESC LIMIT 20
  `).all(like, like, like);

  res.json({ events, participants });
});

module.exports = router;
