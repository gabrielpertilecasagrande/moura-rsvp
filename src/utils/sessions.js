'use strict';
// Login persistente (PWA/app): refresh tokens opacos guardados só como hash, no
// índice global (router.db) junto do tenant de cada sessão. O app troca o refresh
// por um novo JWT de acesso sem pedir senha, mantendo o usuário logado entre
// sessões. Não rotaciona o refresh token (evita corrida entre abas/dispositivos);
// usa expiração ROLANTE: cada uso estende a validade por mais REFRESH_TTL_DAYS
// dias. "Sair" revoga. O token em si é opaco (sem tenant embutido); o tenant fica
// na linha, então a renovação sabe qual banco abrir sem expor nada ao cliente.
const crypto = require('crypto');
const { routerDb } = require('../router');
const { openTenantDb } = require('../db');

const REFRESH_TTL_DAYS = 60;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const expiryFromNow = () => new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

// Cria um refresh token para o usuário (no tenant dado) e devolve o valor em
// texto (mostrado uma única vez ao cliente; no banco fica só o hash).
function createRefreshToken(tenantSlug, userId, userAgent) {
  const plain = crypto.randomBytes(32).toString('hex');
  routerDb.prepare(
    `INSERT INTO auth_sessions (user_id, tenant_slug, token_hash, user_agent, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(userId, tenantSlug, sha256(plain), userAgent ? String(userAgent).slice(0, 300) : null, expiryFromNow());
  return plain;
}

// Valida o refresh token e, se válido, renova a validade (rolling) e devolve
// { user, tenantSlug }. Retorna null se inválido, expirado, revogado, tenant
// inexistente ou conta não mais ativa.
function useRefreshToken(plain) {
  if (!plain) return null;
  const row = routerDb.prepare(
    "SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')"
  ).get(sha256(plain));
  if (!row) return null;
  let user;
  try {
    user = openTenantDb(row.tenant_slug)
      .prepare('SELECT id, name, email, role, status FROM admins WHERE id = ?')
      .get(row.user_id);
  } catch { return null; }
  if (!user || user.status !== 'ativo') return null;
  // Renova: estende a expiração e marca o último uso (mantém a sessão viva).
  routerDb.prepare("UPDATE auth_sessions SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?")
    .run(expiryFromNow(), row.id);
  return { user, tenantSlug: row.tenant_slug };
}

// Revoga um refresh token específico (logout consciente do usuário).
function revokeRefreshToken(plain) {
  if (!plain) return;
  routerDb.prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL")
    .run(sha256(plain));
}

// Lista as sessões ativas (aparelhos conectados) de um usuário, dentro do seu
// tenant. Marca como `current` a sessão do refresh token informado. Nunca devolve
// o hash do token ao cliente.
function listSessions(userId, tenantSlug, currentPlain) {
  const currentHash = currentPlain ? sha256(currentPlain) : null;
  return routerDb.prepare(
    `SELECT id, user_agent, created_at, last_used_at, token_hash
       FROM auth_sessions
      WHERE user_id = ? AND tenant_slug = ? AND revoked_at IS NULL AND expires_at > datetime('now')
      ORDER BY last_used_at DESC`
  ).all(userId, tenantSlug).map((r) => ({
    id: r.id,
    user_agent: r.user_agent,
    created_at: r.created_at,
    last_used_at: r.last_used_at,
    current: currentHash != null && r.token_hash === currentHash,
  }));
}

// Revoga todas as sessões do usuário (no seu tenant) EXCETO a do refresh token
// informado (mantém o aparelho atual logado). Sem keepPlain, revoga todas.
function revokeOtherSessions(userId, tenantSlug, keepPlain) {
  const keepHash = keepPlain ? sha256(keepPlain) : null;
  routerDb.prepare(
    "UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND tenant_slug = ? AND revoked_at IS NULL AND token_hash IS NOT ?"
  ).run(userId, tenantSlug, keepHash);
}

// Limpeza preguiçosa: remove sessões expiradas/revogadas antigas (chamada no login).
function pruneExpiredSessions() {
  try {
    routerDb.prepare(
      "DELETE FROM auth_sessions WHERE expires_at < datetime('now') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now','-7 day'))"
    ).run();
  } catch { /* não bloqueia o fluxo de login */ }
}

module.exports = { createRefreshToken, useRefreshToken, revokeRefreshToken, listSessions, revokeOtherSessions, pruneExpiredSessions, REFRESH_TTL_DAYS };
