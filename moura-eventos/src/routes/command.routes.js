const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

const ymd = (d) => d.toISOString().slice(0, 10);

// GET /api/command-center — tudo que exige atenção, com alertas inteligentes.
router.get('/', (req, res) => {
  const today = ymd(new Date());
  const in7   = ymd(new Date(Date.now() + 7 * 864e5));
  const in30  = ymd(new Date(Date.now() + 30 * 864e5));

  const ids = authorizedEventIds(req.admin);
  // Cláusula de escopo por evento (admin = sem restrição).
  const scope = (col) => {
    if (ids === null) return { c: '', p: [] };
    if (ids.length === 0) return { c: `AND ${col} IN (NULL)`, p: [] };
    return { c: `AND ${col} IN (${ids.map(() => '?').join(',')})`, p: ids };
  };

  const s1 = scope('c.event_id');
  const overdueTasks = db.prepare(
    `SELECT c.id, c.title, c.due_date, c.responsible, c.priority, c.event_id, e.name AS event_name
     FROM checklist c JOIN events e ON e.id = c.event_id
     WHERE c.status != 'Concluído' AND c.due_date IS NOT NULL AND c.due_date < ? ${s1.c}
     ORDER BY c.due_date ASC LIMIT 50`
  ).all(today, ...s1.p);

  const s2 = scope('c.event_id');
  const criticalTasks = db.prepare(
    `SELECT c.id, c.title, c.due_date, c.responsible, c.event_id, e.name AS event_name
     FROM checklist c JOIN events e ON e.id = c.event_id
     WHERE c.status != 'Concluído' AND c.priority = 'Crítica' ${s2.c}
     ORDER BY c.due_date ASC LIMIT 50`
  ).all(...s2.p);

  const s3 = scope('c.event_id');
  const upcomingPayments = db.prepare(
    `SELECT c.id, c.value, c.payment_due_date, c.payment_status, c.event_id, e.name AS event_name, s.company
     FROM contracts c JOIN events e ON e.id = c.event_id JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.payment_status != 'Pago' AND c.payment_due_date IS NOT NULL
       AND c.payment_due_date BETWEEN ? AND ? ${s3.c}
     ORDER BY c.payment_due_date ASC LIMIT 50`
  ).all(today, in7, ...s3.p);

  const s4 = scope('e.id');
  const upcomingEvents = db.prepare(
    `SELECT e.id, e.name, e.client, e.event_date, e.status
     FROM events e WHERE e.event_date BETWEEN ? AND ? ${s4.c}
     ORDER BY e.event_date ASC LIMIT 50`
  ).all(today, in30, ...s4.p);

  const s5 = scope('c.event_id');
  const pendingContracts = db.prepare(
    `SELECT c.id, c.value, c.status, c.event_id, e.name AS event_name, s.company
     FROM contracts c JOIN events e ON e.id = c.event_id JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.status IN ('Em negociação', 'Aguardando aprovação') ${s5.c}
     ORDER BY c.created_at DESC LIMIT 50`
  ).all(...s5.p);

  // Inteligência operacional: alertas gerados automaticamente.
  const insights = [];
  if (overdueTasks.length) insights.push({ level: 'red',  text: `${overdueTasks.length} tarefa(s) atrasada(s) exigem ação imediata.` });
  if (criticalTasks.length) insights.push({ level: 'red',  text: `${criticalTasks.length} tarefa(s) crítica(s) em aberto.` });
  if (upcomingPayments.length) {
    const total = upcomingPayments.reduce((s, p) => s + (p.value || 0), 0);
    insights.push({ level: 'amber', text: `${upcomingPayments.length} pagamento(s) vencem em 7 dias (${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).` });
  }
  if (pendingContracts.length) insights.push({ level: 'amber', text: `${pendingContracts.length} contratação(ões) aguardando definição.` });
  if (upcomingEvents.length) insights.push({ level: 'green', text: `${upcomingEvents.length} evento(s) nos próximos 30 dias.` });
  if (!insights.length) insights.push({ level: 'green', text: 'Tudo em dia. Nenhum item crítico no momento. ✅' });

  res.json({
    counts: {
      overdueTasks: overdueTasks.length,
      criticalTasks: criticalTasks.length,
      upcomingPayments: upcomingPayments.length,
      upcomingEvents: upcomingEvents.length,
      pendingContracts: pendingContracts.length,
    },
    overdueTasks, criticalTasks, upcomingPayments, upcomingEvents, pendingContracts,
    insights,
  });
});

module.exports = router;
