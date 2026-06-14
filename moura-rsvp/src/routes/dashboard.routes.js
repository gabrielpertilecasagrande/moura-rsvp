const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard — números gerais
router.get('/', (_req, res) => {
  const totalEvents = db.prepare('SELECT COUNT(*) c FROM events').get().c;
  const activeEvents = db.prepare("SELECT COUNT(*) c FROM events WHERE status='ativo'").get().c;
  const confirmed = db.prepare("SELECT COUNT(*) c FROM participants WHERE response='confirmado'").get().c;
  const declined = db.prepare("SELECT COUNT(*) c FROM participants WHERE response='recusado'").get().c;

  // "Pendentes" = soma de (convidados esperados - respostas) por evento que informou nº esperado.
  // No modelo de link único não existe "pendente" nativo: ele só faz sentido se o evento
  // declarar quantos convidados são esperados (campo expected_guests).
  const perEvent = db.prepare(`
    SELECT e.expected_guests AS exp,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id=e.id) AS resp
    FROM events e WHERE e.expected_guests > 0
  `).all();
  const pending = perEvent.reduce((acc, r) => acc + Math.max(0, r.exp - r.resp), 0);

  res.json({ totalEvents, activeEvents, confirmed, declined, pending });
});

module.exports = router;
