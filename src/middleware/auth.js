'use strict';
const jwt = require('jsonwebtoken');
const { openTenantDb, runWithDb } = require('../db');

const SECRET = process.env.JWT_SECRET || 'dev-secret';

// Emite um JWT de acesso (curto: 12h) que inclui o tenant do admin. O login
// persistente vem do refresh token (ver utils/sessions.js): o app troca o refresh
// por um novo JWT sem pedir senha, então "sempre logado" não depende de um JWT
// longo. Token curto limita o estrago de um vazamento; requireAuth ainda recarrega
// o usuário do banco (por tenant) a cada requisição — bloqueio/inativação imediatos.
function sign(admin, tenantSlug) {
  return jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role || 'operador',
      tenant_slug: tenantSlug,
    },
    SECRET,
    { expiresIn: '12h' }
  );
}

// Protege rotas administrativas. Espera header Authorization: Bearer <token>.
// Recarrega o usuário do banco a cada requisição (mudanças de papel / bloqueio
// têm efeito imediato). Também define o contexto de tenant via AsyncLocalStorage
// para que todas as chamadas a db.prepare() na cadeia de middlewares abaixo
// usem automaticamente o banco correto.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }

  // Tokens de handshake SSO (com claim "target") só servem para /api/auth/sso.
  if (payload.target) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });

  const tenantSlug = payload.tenant_slug;
  if (!tenantSlug) {
    // Tokens emitidos antes da migração multi-tenant não têm tenant_slug.
    return res.status(401).json({ error: 'Sessão sem tenant. Faça login novamente.' });
  }

  const tenantDb = openTenantDb(tenantSlug);
  const u = tenantDb.prepare('SELECT id, name, email, role, status, sessions_invalidated_at FROM admins WHERE id = ?').get(payload.id);
  if (!u) return res.status(401).json({ error: 'Conta não encontrada. Entre novamente.' });
  // "Sair de todos os outros aparelhos": recusa, na hora, JWTs emitidos antes da
  // invalidação. O aparelho atual recebe um token novo e segue logado.
  if (u.sessions_invalidated_at && payload.iat && payload.iat < u.sessions_invalidated_at) {
    return res.status(401).json({ error: 'Sessão encerrada em outro dispositivo. Entre novamente.' });
  }
  if (u.status !== 'ativo') {
    const msg =
      u.status === 'bloqueado' ? 'Sua conta foi bloqueada. Procure um administrador.'
      : u.status === 'inativo' ? 'Sua conta está inativa. Procure um administrador.'
      : 'Sua conta não está ativa. Procure um administrador.';
    return res.status(401).json({ error: msg });
  }

  req.admin = u;
  req.tenantSlug = tenantSlug;

  // Estabelece o contexto de tenant para todas as rotas abaixo.
  runWithDb(tenantSlug, () => next());
}

// Exige papel de administrador (acesso total). Use após requireAuth.
function requireAdmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem acessar esta área.' });
  }
  next();
}

module.exports = { sign, requireAuth, requireAdmin, SECRET };
