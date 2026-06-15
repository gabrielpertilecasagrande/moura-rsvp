const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard — números gerais (restritos aos eventos que o usuário pode ver)
router.get('/', (req, res) => {
  const ids = authorizedEventIds(req.admin); // null = admin (todos)
  // Cláusula de filtro reutilizável para events (alias e) e participants (alias p).
  let evWhere = '';
  let pWhere = '';
  let params = [];
  if (ids !== null) {
    if (!ids.length) {
      return res.json({ totalEvents: 0, activeEvents: 0, confirmed: 0, declined: 0, pending: 0,
        totalResponses: 0, totalExpected: 0, responseRate: null });
    }
    const ph = ids.map(() => '?').join(',');
    evWhere = `WHERE e.id IN (${ph})`;
    pWhere = `WHERE p.event_id IN (${ph})`;
    params = ids;
  }

  const totalEvents = db.prepare(`SELECT COUNT(*) c FROM events e ${evWhere}`).get(...params).c;
  const activeEvents = db.prepare(`SELECT COUNT(*) c FROM events e ${evWhere}${evWhere ? ' AND' : ' WHERE'} e.status='ativo'`).get(...params).c;
  const confirmed = db.prepare(`SELECT COUNT(*) c FROM participants p ${pWhere}${pWhere ? ' AND' : ' WHERE'} p.response='confirmado'`).get(...params).c;
  const declined = db.prepare(`SELECT COUNT(*) c FROM participants p ${pWhere}${pWhere ? ' AND' : ' WHERE'} p.response='recusado'`).get(...params).c;

  const perEvent = db.prepare(`
    SELECT e.expected_guests AS exp,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id=e.id) AS resp
    FROM events e ${evWhere}${evWhere ? ' AND' : ' WHERE'} e.expected_guests > 0
  `).all(...params);
  const pending = perEvent.reduce((acc, r) => acc + Math.max(0, r.exp - r.resp), 0);

  const totalResponses = confirmed + declined;
  const totalExpected = perEvent.reduce((acc, r) => acc + r.exp, 0);
  const respExpected = perEvent.reduce((acc, r) => acc + r.resp, 0);
  const responseRate = totalExpected > 0 ? Math.round((respExpected / totalExpected) * 100) : null;

  res.json({
    totalEvents, activeEvents, confirmed, declined, pending,
    totalResponses, totalExpected, responseRate,
  });
});

module.exports = router;
