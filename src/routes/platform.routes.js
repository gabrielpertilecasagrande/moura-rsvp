'use strict';
// Rotas de administração da plataforma (nível super-operador, não por tenant).
//
// Servem para o operador da plataforma provisionar novos organizadores sem
// acesso SSH. NÃO há self-service: o acesso é protegido por um token estático
// definido em PLATFORM_TOKEN. Se a variável não estiver configurada, as rotas
// ficam desativadas (respondem 404) — evita exposição acidental.

const express = require('express');
const { provisionTenant, ProvisionError } = require('../provision');
const router = require('../router');

const r = express.Router();

const PLATFORM_TOKEN = process.env.PLATFORM_TOKEN || '';

// Exige Authorization: Bearer <PLATFORM_TOKEN>. Comparação em tempo constante.
function requirePlatform(req, res, next) {
  if (!PLATFORM_TOKEN) {
    return res.status(404).json({ error: 'Não encontrado.' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(PLATFORM_TOKEN);
  const crypto = require('crypto');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

r.use(requirePlatform);

// GET /api/platform/tenants — lista organizações cadastradas.
r.get('/tenants', (_req, res) => {
  res.json(router.listOrganizations());
});

// POST /api/platform/tenants — provisiona um novo organizador.
// Body: { orgSlug?, orgName, adminName?, adminEmail, adminPassword }
r.post('/tenants', (req, res) => {
  try {
    const result = provisionTenant(req.body || {});
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof ProvisionError) {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('[platform] erro ao provisionar tenant:', e.message);
    res.status(500).json({ error: 'Erro ao provisionar organização.' });
  }
});

module.exports = r;
