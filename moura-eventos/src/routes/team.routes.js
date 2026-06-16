const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authorizedEventIds } = require('../utils/permissions');

const router = express.Router();
router.use(requireAuth);

const today = () => new Date().toISOString().slice(0, 10);

// GET /api/team — visão por responsável (tarefas, eventos, contratos).
router.get('/', (req, res) => {
  const ids = authorizedEventIds(req.admin);
  const scope = (col) => {
    if (ids === null) return { c: '', p: [] };
    if (ids.length === 0) return { c: `AND ${col} IN (NULL)`, p: [] };
    return { c: `AND ${col} IN (${ids.map(() => '?').join(',')})`, p: ids };
  };

  const st = scope('event_id');
  const tasks = db.prepare(
    `SELECT responsible, status, due_date FROM checklist
     WHERE responsible IS NOT NULL AND TRIM(responsible) <> '' ${st.c}`
  ).all(...st.p);

  const se = scope('id');
  const events = db.prepare(
    `SELECT responsible FROM events
     WHERE responsible IS NOT NULL AND TRIM(responsible) <> '' ${se.c}`
  ).all(...se.p);

  const sc = scope('c.event_id');
  const contracts = db.prepare(
    `SELECT e.responsible, c.value FROM contracts c JOIN events e ON e.id = c.event_id
     WHERE e.responsible IS NOT NULL AND TRIM(e.responsible) <> '' ${sc.c}`
  ).all(...sc.p);

  const t = today();
  const map = new Map();
  const get = (name) => {
    const key = name.trim();
    if (!map.has(key)) map.set(key, { name: key, openTasks: 0, overdueTasks: 0, events: 0, contractsValue: 0 });
    return map.get(key);
  };
  for (const r of tasks) {
    const g = get(r.responsible);
    if (r.status !== 'Concluído') {
      g.openTasks++;
      if (r.due_date && r.due_date < t) g.overdueTasks++;
    }
  }
  for (const r of events) get(r.responsible).events++;
  for (const r of contracts) get(r.responsible).contractsValue += r.value || 0;

  const list = [...map.values()].sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name, 'pt-BR'));
  res.json(list);
});

module.exports = router;
