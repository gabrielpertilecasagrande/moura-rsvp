const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/activity?limit=&q=  — lista de atividades administrativas (apenas admin)
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(
      'SELECT * FROM activity_log WHERE actor LIKE ? OR action LIKE ? OR details LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(`%${q}%`, `%${q}%`, `%${q}%`, limit);
  } else {
    rows = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }
  res.json(rows);
});

module.exports = router;
