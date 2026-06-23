// Controle de acesso por papel (perfil) e por evento.
//
// Perfis:
//  - admin    : acesso total ao sistema (vê todos os eventos, gerencia usuários).
//  - gestor   : cria e gerencia os eventos autorizados; não gerencia usuários.
//  - operador : consulta eventos autorizados e gerencia participantes; não cria eventos
//               nem acessa configurações administrativas.
//
// Cada usuário (não-admin) possui uma lista de eventos autorizados, com permissões
// específicas por evento (tabela event_access).
const db = require('../db');

// As 8 permissões granulares por evento (chave da coluna + rótulo exibido).
const PERMS = [
  { key: 'can_view', label: 'Visualizar evento' },
  { key: 'can_edit', label: 'Editar evento' },
  { key: 'can_participants', label: 'Gerenciar participantes' },
  { key: 'can_export', label: 'Exportar relatórios' },
  { key: 'can_history', label: 'Visualizar histórico' },
  { key: 'can_messages', label: 'Enviar mensagens' },
  { key: 'can_duplicate', label: 'Duplicar evento' },
  { key: 'can_delete', label: 'Excluir evento' },
];
const PERM_KEYS = PERMS.map((p) => p.key);

const ROLES = ['admin', 'gestor', 'operador', 'cliente'];
const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador', cliente: 'Cliente', editor: 'Gestor de Eventos' };

// Normaliza papéis antigos ('editor') para o novo modelo.
function normalizeRole(role) {
  if (role === 'editor') return 'gestor';
  return ROLES.includes(role) ? role : 'operador';
}

// Permissões padrão sugeridas ao liberar um evento para um usuário ("aplicar padrão").
function defaultPermsForRole(role) {
  const out = {};
  if (normalizeRole(role) === 'cliente') {
    // Cliente: apenas visualizar evento e lista de participantes por padrão.
    for (const k of PERM_KEYS) out[k] = 0;
    out.can_view = 1;
    out.can_participants = 1;
    return out;
  }
  // Gestor / Operador: todas exceto duplicar e excluir (ações sensíveis).
  for (const k of PERM_KEYS) out[k] = 1;
  out.can_duplicate = 0;
  out.can_delete = 0;
  return out;
}

function getAccess(userId, eventId) {
  return db.prepare('SELECT * FROM event_access WHERE user_id = ? AND event_id = ?').get(userId, eventId);
}

// Permissões efetivas do usuário em um evento (admin = tudo liberado).
function permsFor(user, eventId) {
  const out = {};
  if (user && normalizeRole(user.role) === 'admin') {
    for (const k of PERM_KEYS) out[k] = true;
    return out;
  }
  const a = user ? getAccess(user.id, eventId) : null;
  for (const k of PERM_KEYS) out[k] = !!(a && a[k]);
  return out;
}

function userCan(user, eventId, perm) {
  if (!user) return false;
  if (normalizeRole(user.role) === 'admin') return true;
  const a = getAccess(user.id, Number(eventId));
  return !!(a && a[perm]);
}

// IDs dos eventos que o usuário pode visualizar. Retorna null para admin (= todos).
function authorizedEventIds(user) {
  if (!user) return [];
  if (normalizeRole(user.role) === 'admin') return null;
  return db.prepare('SELECT event_id FROM event_access WHERE user_id = ? AND can_view = 1').all(user.id).map((r) => r.event_id);
}

// Concede acesso total a um evento para um usuário (ex.: quem cria/duplica o evento).
function grantFullAccess(userId, eventId) {
  const cols = PERM_KEYS.join(', ');
  const ph = PERM_KEYS.map(() => '1').join(', ');
  db.prepare(
    `INSERT INTO event_access (user_id, event_id, ${cols}) VALUES (?, ?, ${ph})
     ON CONFLICT(user_id, event_id) DO UPDATE SET ${PERM_KEYS.map((k) => `${k}=1`).join(', ')}`
  ).run(userId, eventId);
}

// ---- Middlewares (usar após requireAuth) ----

// Exige uma das funções informadas.
function requireRole(...roles) {
  const allowed = roles.map(normalizeRole);
  return (req, res, next) => {
    if (allowed.includes(normalizeRole(req.admin.role))) return next();
    return res.status(403).json({ error: 'Seu perfil não permite esta ação.' });
  };
}

// Exige uma permissão específica no evento de req.params.id.
function requirePerm(perm) {
  return (req, res, next) => {
    if (normalizeRole(req.admin.role) === 'admin') return next();
    if (userCan(req.admin, req.params.id, perm)) return next();
    return res.status(403).json({ error: 'Você não tem permissão para esta ação neste evento.' });
  };
}

module.exports = {
  PERMS, PERM_KEYS, ROLES, ROLE_LABELS,
  normalizeRole, defaultPermsForRole, getAccess, permsFor, userCan,
  authorizedEventIds, grantFullAccess, requireRole, requirePerm,
};
