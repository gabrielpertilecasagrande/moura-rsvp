const db = require('../db');

const PERMS = [
  { key: 'can_view',      label: 'Visualizar evento' },
  { key: 'can_edit',      label: 'Editar evento' },
  { key: 'can_contracts', label: 'Gerenciar contratações' },
  { key: 'can_checklist', label: 'Gerenciar checklist' },
  { key: 'can_files',     label: 'Gerenciar arquivos' },
  { key: 'can_diary',     label: 'Registrar no diário' },
  { key: 'can_delete',    label: 'Excluir evento' },
];
const PERM_KEYS = PERMS.map((p) => p.key);

const ROLES = ['admin', 'gestor', 'operador'];
const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador' };

function normalizeRole(role) {
  if (role === 'editor') return 'gestor';
  return ROLES.includes(role) ? role : 'operador';
}

// Permissões sugeridas (pré-marcadas na tela de acesso) conforme o papel.
// Gestor recebe acesso operacional completo exceto exclusão; operador recebe
// apenas o essencial (visualizar, checklist, diário).
function defaultPermsForRole(role) {
  const out = {};
  for (const k of PERM_KEYS) out[k] = 0;
  if (normalizeRole(role) === 'operador') {
    out.can_view = 1; out.can_checklist = 1; out.can_diary = 1;
  } else {
    for (const k of PERM_KEYS) out[k] = 1;
    out.can_delete = 0;
  }
  return out;
}

function getAccess(userId, eventId) {
  return db.prepare('SELECT * FROM event_access WHERE user_id = ? AND event_id = ?').get(userId, eventId);
}

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

function authorizedEventIds(user) {
  if (!user) return [];
  if (normalizeRole(user.role) === 'admin') return null;
  return db.prepare('SELECT event_id FROM event_access WHERE user_id = ? AND can_view = 1').all(user.id).map((r) => r.event_id);
}

function grantFullAccess(userId, eventId) {
  const cols = PERM_KEYS.join(', ');
  const ph = PERM_KEYS.map(() => '1').join(', ');
  db.prepare(
    `INSERT INTO event_access (user_id, event_id, ${cols}) VALUES (?, ?, ${ph})
     ON CONFLICT(user_id, event_id) DO UPDATE SET ${PERM_KEYS.map((k) => `${k}=1`).join(', ')}`
  ).run(userId, eventId);
}

function requireRole(...roles) {
  const allowed = roles.map(normalizeRole);
  return (req, res, next) => {
    if (allowed.includes(normalizeRole(req.admin.role))) return next();
    return res.status(403).json({ error: 'Seu perfil não permite esta ação.' });
  };
}

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
