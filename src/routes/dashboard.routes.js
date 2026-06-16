const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds, normalizeRole } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const isAdmin = normalizeRole(req.admin.role) === 'admin';
  const ids = authorizedEventIds(req.admin);

  let eventsWhere = '';
  let eventsParams = [];
  if (!isAdmin && ids !== null) {
    if (ids.length === 0) {
      eventsWhere = 'WHERE 1=0';
    } else {
      eventsWhere = `WHERE id IN (${ids.map(() => '?').join(',')})`;
      eventsParams = ids;
    }
  }

  const totalEvents = db.prepare(`SELECT COUNT(*) AS n FROM events ${eventsWhere}`).get(...eventsParams).n;

  const byStatus = db.prepare(
    `SELECT status, COUNT(*) AS n FROM events ${eventsWhere} GROUP BY status`
  ).all(...eventsParams);

  const totalSuppliers = db.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n;

  const contractsByPayment = db.prepare(
    `SELECT payment_status, COUNT(*) AS n FROM contracts
     ${eventsWhere ? eventsWhere.replace('WHERE id', 'WHERE event_id') : ''}
     GROUP BY payment_status`
  ).all(...eventsParams);

  const pendingPayments = db.prepare(
    `SELECT COUNT(*) AS n FROM contracts
     WHERE payment_status = 'Pendente'
     ${!isAdmin && ids !== null && ids.length > 0 ? `AND event_id IN (${ids.map(() => '?').join(',')})` : isAdmin ? '' : ids !== null && ids.length === 0 ? 'AND 1=0' : ''}`
  ).get(...(isAdmin || ids === null ? [] : ids)).n;

  const pendingChecklist = db.prepare(
    `SELECT COUNT(*) AS n FROM checklist
     WHERE status = 'Pendente'
     ${!isAdmin && ids !== null && ids.length > 0 ? `AND event_id IN (${ids.map(() => '?').join(',')})` : isAdmin ? '' : ids !== null && ids.length === 0 ? 'AND 1=0' : ''}`
  ).get(...(isAdmin || ids === null ? [] : ids)).n;

  const recentActivity = db.prepare(
    'SELECT actor, action, details, created_at FROM activity_log ORDER BY created_at DESC LIMIT 10'
  ).all();

  const recentEvents = db.prepare(
    `SELECT id, name, client, event_date, status FROM events ${eventsWhere} ORDER BY created_at DESC LIMIT 5`
  ).all(...eventsParams);

  const today = new Date().toISOString().slice(0, 10);

  const upcomingEvents = db.prepare(
    `SELECT id, name, client, event_date, status FROM events
     ${eventsWhere ? eventsWhere + ' AND event_date >= ?' : 'WHERE event_date >= ?'}
     ORDER BY event_date ASC LIMIT 5`
  ).all(...eventsParams, today);

  const overdueTasks = db.prepare(
    `SELECT COUNT(*) AS n FROM checklist
     WHERE due_date < ? AND status != 'Concluído'
     ${!isAdmin && ids !== null && ids.length > 0 ? `AND event_id IN (${ids.map(() => '?').join(',')})` : isAdmin ? '' : ids !== null && ids.length === 0 ? 'AND 1=0' : ''}`
  ).get(today, ...(isAdmin || ids === null ? [] : ids)).n;

  const pendingContractsCount = db.prepare(
    `SELECT COUNT(*) AS n FROM contracts
     WHERE status = 'Em negociação'
     ${!isAdmin && ids !== null && ids.length > 0 ? `AND event_id IN (${ids.map(() => '?').join(',')})` : isAdmin ? '' : ids !== null && ids.length === 0 ? 'AND 1=0' : ''}`
  ).get(...(isAdmin || ids === null ? [] : ids)).n;

  const pendingPaymentsValue = db.prepare(
    `SELECT COALESCE(SUM(value), 0) AS total FROM contracts
     WHERE payment_status = 'Pendente'
     ${!isAdmin && ids !== null && ids.length > 0 ? `AND event_id IN (${ids.map(() => '?').join(',')})` : isAdmin ? '' : ids !== null && ids.length === 0 ? 'AND 1=0' : ''}`
  ).get(...(isAdmin || ids === null ? [] : ids)).total;

  res.json({
    totalEvents,
    byStatus,
    totalSuppliers,
    contractsByPayment,
    pendingPayments,
    pendingChecklist,
    recentActivity,
    recentEvents,
    upcomingEvents,
    overdueTasks,
    pendingContractsCount,
    pendingPaymentsValue,
  });
});

module.exports = router;
