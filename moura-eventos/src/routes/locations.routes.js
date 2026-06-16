const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/locations — cidades já usadas no sistema (para autocomplete).
router.get('/', (_req, res) => {
  const rows = db.prepare(
    `SELECT city FROM (
       SELECT city FROM events WHERE city IS NOT NULL AND TRIM(city) <> ''
       UNION SELECT city FROM suppliers WHERE city IS NOT NULL AND TRIM(city) <> ''
     ) GROUP BY city COLLATE NOCASE ORDER BY city COLLATE NOCASE`
  ).all();
  res.json({ cities: rows.map((r) => r.city) });
});

module.exports = router;
