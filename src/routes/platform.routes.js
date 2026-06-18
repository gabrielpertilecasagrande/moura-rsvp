'use strict';
// Rotas de administração da plataforma (nível super-operador, não por tenant).
//
// Acesso por dois mecanismos (qualquer um é suficiente):
//   1. JWT de sessão com is_platform_admin: true  → admin logado do tenant padrão
//   2. Bearer <PLATFORM_TOKEN> estático           → scripts/CLI/acesso de emergência
//
// Se nenhum dos dois estiver disponível, retorna 401.

const express = require('express');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { provisionTenant, ProvisionError } = require('../provision');
const { openTenantDb } = require('../db');
const router  = require('../router');
const { SECRET } = require('../middleware/auth');

const r = express.Router();

const PLATFORM_TOKEN = process.env.PLATFORM_TOKEN || '';

function requirePlatform(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Não autorizado.' });

  // Caminho 1: JWT de sessão com flag is_platform_admin.
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.is_platform_admin) { next(); return; }
  } catch { /* não é JWT válido — tenta PLATFORM_TOKEN */ }

  // Caminho 2: token estático PLATFORM_TOKEN (CLI / emergência).
  if (!PLATFORM_TOKEN) return res.status(401).json({ error: 'Não autorizado.' });
  const a = Buffer.from(token);
  const b = Buffer.from(PLATFORM_TOKEN);
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

// GET /api/platform/tenants/:slug/backup — snapshot consistente via VACUUM INTO.
r.get('/tenants/:slug/backup', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase().trim();
  if (!router.organizationExists(slug)) {
    return res.status(404).json({ error: 'Organização não encontrada.' });
  }
  const db   = openTenantDb(slug);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmp   = path.join(os.tmpdir(), `rsvp-${slug}-${stamp}-${Math.random().toString(36).slice(2, 7)}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (e) {
    console.error('[platform] erro ao gerar backup:', e.message);
    return res.status(500).json({ error: 'Não foi possível gerar o backup.' });
  }
  res.download(tmp, `rsvp-${slug}-${stamp}.db`, (err) => {
    fs.unlink(tmp, () => {});
    if (err && !res.headersSent) res.status(500).json({ error: 'Falha ao enviar o backup.' });
  });
});

module.exports = r;
