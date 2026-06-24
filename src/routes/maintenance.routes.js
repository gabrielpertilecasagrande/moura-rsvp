'use strict';
// Aviso de manutenção programada (nível sistema, não por tenant).
//
// GET /api/maintenance  — público, sem auth.
// PUT /api/maintenance  — serviço: chamada do Moura One (JWT assinado com JWT_SECRET).

const express = require('express');
const jwt     = require('jsonwebtoken');
const { routerDb } = require('../router');
// Reutiliza o SECRET já validado no boot (src/middleware/auth.js exige um valor
// forte em produção) em vez de redefinir um fallback 'dev-secret' duplicado.
const { SECRET } = require('../middleware/auth');

const router = express.Router();

function getRow() {
  return routerDb.prepare('SELECT * FROM maintenance_notice WHERE id = 1').get() || {};
}

function nowIso() { return new Date().toISOString(); }

// GET /api/maintenance — público
router.get('/', (_req, res) => {
  const row = getRow();
  if (!row.enabled) return res.json({ active: false, upcoming: false });
  const now = nowIso();
  const active   = row.start_at <= now && now < row.end_at;
  const upcoming = !active && row.start_at > now;
  if (!active && !upcoming) return res.json({ active: false, upcoming: false });
  res.json({ active, upcoming, start_at: row.start_at, end_at: row.end_at, message: row.message || null });
});

// PUT /api/maintenance — chamada do Moura One (JWT com service='eventos')
router.put('/', (req, res) => {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const p = jwt.verify(auth, SECRET, { algorithms: ['HS256'] });
    if (p.service !== 'eventos') throw new Error('invalid service');
  } catch { return res.status(401).json({ error: 'Não autorizado.' }); }

  const { enabled, start_at, end_at, message } = req.body || {};
  routerDb.prepare(`
    INSERT INTO maintenance_notice (id, enabled, start_at, end_at, message, updated_at)
    VALUES (1, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      enabled    = excluded.enabled,
      start_at   = excluded.start_at,
      end_at     = excluded.end_at,
      message    = excluded.message,
      updated_at = excluded.updated_at
  `).run(enabled ? 1 : 0, start_at || null, end_at || null, message || null);
  res.json({ ok: true });
});

module.exports = router;
