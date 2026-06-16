const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// Retorna itens datados do período: eventos, prazos de tarefas e vencimentos.
router.get('/', (req, res) => {
  const from = req.query.from || '0000-01-01';
  const to   = req.query.to   || '9999-12-31';

  const ids = authorizedEventIds(req.admin);
  let evIn = '';
  let idParams = [];
  if (ids !== null) {
    if (ids.length === 0) evIn = 'AND 1=0';
    else { evIn = `AND e.id IN (${ids.map(() => '?').join(',')})`; idParams = ids; }
  }

  const events = db.prepare(
    `SELECT e.id, e.name, e.event_date AS date, e.status, e.event_type
     FROM events e WHERE e.event_date BETWEEN ? AND ? ${evIn}`
  ).all(from, to, ...idParams);

  const tasks = db.prepare(
    `SELECT c.id, c.title, c.due_date AS date, c.status, c.priority, c.event_id, e.name AS event_name
     FROM checklist c JOIN events e ON e.id = c.event_id
     WHERE c.due_date BETWEEN ? AND ? AND c.status != 'Concluído' ${evIn}`
  ).all(from, to, ...idParams);

  const payments = db.prepare(
    `SELECT c.id, c.value, c.payment_due_date AS date, c.payment_status, c.event_id, e.name AS event_name, s.company
     FROM contracts c JOIN events e ON e.id = c.event_id JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.payment_due_date BETWEEN ? AND ? AND c.payment_status != 'Pago' ${evIn}`
  ).all(from, to, ...idParams);

  res.json({ events, tasks, payments });
});

module.exports = router;
