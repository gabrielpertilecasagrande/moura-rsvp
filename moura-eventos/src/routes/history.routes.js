const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds, normalizeRole } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/history — banco de eventos anteriores (realizados/encerrados ou já passados)
// com métricas históricas por tipo, para servir de referência a novos eventos.
router.get('/', (req, res) => {
  const isAdmin = normalizeRole(req.admin.role) === 'admin';
  const ids = authorizedEventIds(req.admin);

  let where = `WHERE (e.status IN ('Evento realizado', 'Encerrado')
                OR (e.event_date IS NOT NULL AND e.event_date < date('now')))`;
  const params = [];

  if (!isAdmin && ids !== null) {
    if (ids.length === 0) return res.json({ events: [], summary: { count: 0, total: 0, avg: 0 }, byType: [], years: [] });
    where += ` AND e.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }

  const { q, type, year, city } = req.query;
  if (q)    { where += ' AND (e.name LIKE ? OR e.client LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (type) { where += ' AND e.event_type = ?'; params.push(type); }
  if (city) { where += ' AND e.city = ?'; params.push(city); }
  if (year) { where += " AND strftime('%Y', e.event_date) = ?"; params.push(String(year)); }

  const events = db.prepare(`
    SELECT e.*,
      (SELECT COALESCE(SUM(c.value), 0) FROM contracts c WHERE c.event_id = e.id) AS total_value,
      (SELECT COUNT(*) FROM contracts c WHERE c.event_id = e.id) AS suppliers_count
    FROM events e
    ${where}
    ORDER BY e.event_date DESC, e.created_at DESC
  `).all(...params);

  const summary = {
    count: events.length,
    total: events.reduce((s, e) => s + (e.total_value || 0), 0),
  };
  summary.avg = summary.count ? summary.total / summary.count : 0;

  // Quebra por tipo — média de custo por tipo serve de benchmark de orçamento.
  const typeMap = {};
  for (const e of events) {
    const t = e.event_type || 'Sem tipo';
    if (!typeMap[t]) typeMap[t] = { type: t, count: 0, total: 0 };
    typeMap[t].count++;
    typeMap[t].total += e.total_value || 0;
  }
  const byType = Object.values(typeMap)
    .map((t) => ({ ...t, avg: t.count ? t.total / t.count : 0 }))
    .sort((a, b) => b.count - a.count);

  const years = [...new Set(events.map((e) => (e.event_date ? e.event_date.slice(0, 4) : null)).filter(Boolean))]
    .sort().reverse();

  res.json({ events, summary, byType, years });
});

module.exports = router;
