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
  // Sempre ignora itens na lixeira (deleted_at IS NOT NULL).
  let evWhere = 'WHERE e.deleted_at IS NULL';
  // Convidados contam apenas se NÃO estão na lixeira e o evento também não está.
  let pWhere = 'WHERE p.deleted_at IS NULL AND e.deleted_at IS NULL';
  let params = [];
  if (ids !== null) {
    if (!ids.length) {
      return res.json({ totalEvents: 0, activeEvents: 0, confirmed: 0, declined: 0, pending: 0,
        totalResponses: 0, totalExpected: 0, responseRate: null });
    }
    const ph = ids.map(() => '?').join(',');
    evWhere += ` AND e.id IN (${ph})`;
    pWhere += ` AND p.event_id IN (${ph})`;
    params = ids;
  }

  const totalEvents = db.prepare(`SELECT COUNT(*) c FROM events e ${evWhere}`).get(...params).c;
  const activeEvents = db.prepare(`SELECT COUNT(*) c FROM events e ${evWhere} AND e.status='ativo'`).get(...params).c;
  const confirmed = db.prepare(`SELECT COUNT(*) c FROM participants p JOIN events e ON e.id = p.event_id ${pWhere} AND p.response='confirmado'`).get(...params).c;
  const declined = db.prepare(`SELECT COUNT(*) c FROM participants p JOIN events e ON e.id = p.event_id ${pWhere} AND p.response='recusado'`).get(...params).c;

  const perEvent = db.prepare(`
    SELECT e.expected_guests AS exp,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id=e.id AND p.deleted_at IS NULL) AS resp
    FROM events e ${evWhere} AND e.expected_guests > 0
  `).all(...params);
  const pending = perEvent.reduce((acc, r) => acc + Math.max(0, r.exp - r.resp), 0);

  const totalResponses = confirmed + declined;
  const totalExpected = perEvent.reduce((acc, r) => acc + r.exp, 0);
  const respExpected = perEvent.reduce((acc, r) => acc + r.resp, 0);
  const responseRate = totalExpected > 0 ? Math.round((respExpected / totalExpected) * 100) : null;

  // Últimas 5 confirmações (transversais a todos os eventos autorizados)
  const recent = db.prepare(`
    SELECT p.name, p.updated_at, e.name AS event_name
    FROM participants p JOIN events e ON e.id = p.event_id
    ${pWhere} AND p.response = 'confirmado'
    ORDER BY p.updated_at DESC LIMIT 5
  `).all(...params);

  // Confirmações por dia nos últimos 7 dias
  const daily = db.prepare(`
    SELECT date(p.updated_at) AS day, COUNT(*) AS n
    FROM participants p JOIN events e ON e.id = p.event_id
    ${pWhere} AND p.response = 'confirmado'
    AND date(p.updated_at) >= date('now', '-6 days')
    GROUP BY day ORDER BY day
  `).all(...params);

  res.json({
    totalEvents, activeEvents, confirmed, declined, pending,
    totalResponses, totalExpected, responseRate,
    recent, daily,
  });
});

module.exports = router;
