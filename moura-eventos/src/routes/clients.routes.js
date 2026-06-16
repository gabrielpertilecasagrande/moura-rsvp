const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/clients — lista de clientes derivada dos eventos, com histórico.
router.get('/', (req, res) => {
  const ids = authorizedEventIds(req.admin);
  let where = "WHERE client IS NOT NULL AND TRIM(client) <> ''";
  let params = [];
  if (ids !== null) {
    if (ids.length === 0) return res.json([]);
    where += ` AND id IN (${ids.map(() => '?').join(',')})`;
    params = ids;
  }

  const rows = db.prepare(
    `SELECT id, name, client, event_date, status,
       (SELECT COALESCE(SUM(value),0) FROM contracts c WHERE c.event_id = events.id) AS total_value
     FROM events ${where} ORDER BY client COLLATE NOCASE, event_date DESC`
  ).all(...params);

  // Agrupa por cliente.
  const map = new Map();
  for (const r of rows) {
    const key = r.client.trim();
    if (!map.has(key)) map.set(key, { client: key, events: [], events_count: 0, total_value: 0 });
    const g = map.get(key);
    g.events.push({ id: r.id, name: r.name, event_date: r.event_date, status: r.status, total_value: r.total_value });
    g.events_count++;
    g.total_value += r.total_value || 0;
  }

  const list = [...map.values()].sort((a, b) => a.client.localeCompare(b.client, 'pt-BR'));
  res.json(list);
});

module.exports = router;
