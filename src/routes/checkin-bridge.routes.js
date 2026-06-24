'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  PONTE DE SINCRONIZAÇÃO PARA O MOURA CHECK-IN
//
//  O RSVP é a fonte da verdade das confirmações ("eu vou"). O serviço de
//  check-in (moura-checkin) PUXA daqui os convidados confirmados de um evento
//  para o banco próprio dele. Esta é a única rota que o check-in consome no RSVP.
//
//  Autenticação: token de serviço máquina-a-máquina (JWT assinado com o
//  JWT_SECRET do RSVP, claim target:'rsvp'), com algoritmo FIXO (HS256). O
//  escopo (organização + evento) vem DENTRO do token assinado — não de header
//  ou URL controláveis — espelhando exatamente o modelo das métricas
//  (events.routes.js → metricsAuth). Assim, um token vazado não vira
//  chave-mestra para ler convidados de outros eventos/organizações.
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { runWithDb }     = require('../db');
const { SECRET }        = require('../middleware/auth');
const { decryptFields } = require('../utils/crypto');
const { organizationExists } = require('../router');

const router = express.Router();

// Autentica o token de serviço e fixa o contexto do tenant (AsyncLocalStorage).
function serviceAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token de serviço ausente.' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Token de serviço inválido.' });
  }
  if (!payload || payload.target !== 'rsvp') {
    return res.status(401).json({ error: 'Token de serviço não autorizado.' });
  }
  const tokenTenant = payload.tenant_slug ? String(payload.tenant_slug).toLowerCase().trim() : null;
  const tokenEvent  = payload.event_id != null ? String(payload.event_id) : null;
  if (!tokenTenant || !tokenEvent) {
    return res.status(403).json({ error: 'Token de serviço sem escopo de organização/evento.' });
  }
  // O evento pedido na URL precisa ser exatamente o autorizado pelo token.
  if (String(req.params.id) !== tokenEvent) {
    return res.status(403).json({ error: 'Token de serviço não autoriza este evento.' });
  }
  // Só aceita um tenant que já existe (evita criar bancos arbitrários / travessia).
  if (!organizationExists(tokenTenant)) {
    return res.status(404).json({ error: 'Organização não encontrada.' });
  }
  return runWithDb(tokenTenant, () => next());
}

// ── GET /api/admin/checkin/events/:id/guests ──────────────────────────────────
// Devolve os convidados CONFIRMADOS do evento para o check-in espelhar. company
// e role são decifrados antes de sair (o check-in os cifra de novo no banco dele).
router.get('/events/:id/guests', serviceAuth, (req, res) => {
  const e = db.prepare('SELECT id FROM events WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const rows = db.prepare(
    `SELECT id, name, company, role, email, phone
       FROM participants
      WHERE event_id = ? AND deleted_at IS NULL AND response = 'confirmado'
      ORDER BY name COLLATE NOCASE ASC`
  ).all(e.id).map(r => decryptFields(r, ['company', 'role']));
  res.json({ participants: rows });
});

module.exports = router;
