'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireAuth, requireAdmin }      = require('../middleware/auth');
const { logActivity }                    = require('../utils/activity');
const { PERM_KEYS, normalizeRole, defaultPermsForRole } = require('../utils/permissions');
const { registerAdminEmail, unregisterAdminEmail, updateAdminEmail } = require('../router');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const publicView = (u) => ({
  id: u.id, name: u.name, email: u.email,
  role: normalizeRole(u.role), status: u.status,
  created_at: u.created_at, last_login: u.last_login,
});

const VALID_ROLES  = ['admin', 'gestor', 'operador', 'cliente'];
const VALID_STATUS = ['pendente', 'ativo', 'recusado', 'inativo', 'bloqueado'];

function countActiveAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND status = 'ativo' AND deleted_at IS NULL").get().n;
}

// GET /api/users/pending-count
router.get('/pending-count', (_req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM admins WHERE status = 'pendente' AND deleted_at IS NULL").get().n;
  res.json({ count });
});

// GET /api/users
router.get('/', (_req, res) => {
  const rows = db.prepare("SELECT * FROM admins WHERE deleted_at IS NULL ORDER BY (status = 'pendente') DESC, name COLLATE NOCASE").all();
  res.json(rows.map(publicView));
});

// POST /api/users — cria usuário já ativo
router.post('/', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  }
  const r    = VALID_ROLES.includes(role) ? role : 'operador';
  const mail = String(email).toLowerCase().trim();
  const dupe = db.prepare('SELECT id, deleted_at FROM admins WHERE email = ?').get(mail);
  if (dupe) {
    if (dupe.deleted_at) return res.status(409).json({ error: 'Há uma conta com este e-mail na lixeira. Restaure-a ou exclua-a permanentemente para reutilizar o e-mail.' });
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare(
    "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'ativo')"
  ).run(String(name).trim(), mail, hash, r);
  const created = db.prepare('SELECT * FROM admins WHERE id = ?').get(info.lastInsertRowid);

  // Registra no índice global para que o login funcione.
  registerAdminEmail(mail, req.tenantSlug);

  logActivity(req.admin.name || req.admin.email, 'criou usuário', created.name);
  res.status(201).json(publicView(created));
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  const id   = Number(req.params.id);
  const user = db.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const b      = req.body || {};
  const name   = b.name   != null ? String(b.name).trim()               : user.name;
  const email  = b.email  != null ? String(b.email).toLowerCase().trim() : user.email;
  const role   = VALID_ROLES.includes(b.role)   ? b.role   : normalizeRole(user.role);
  const status = VALID_STATUS.includes(b.status) ? b.status : user.status;

  if (email !== user.email && db.prepare('SELECT id FROM admins WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }

  const wasActiveAdmin  = user.role === 'admin' && user.status === 'ativo';
  const willBeActiveAdmin = role === 'admin' && status === 'ativo';
  if (wasActiveAdmin && !willBeActiveAdmin && countActiveAdmins() <= 1) {
    return res.status(409).json({ error: 'Não é possível remover o último administrador ativo do sistema.' });
  }

  db.prepare('UPDATE admins SET name = ?, email = ?, role = ?, status = ? WHERE id = ?').run(name, email, role, status, id);

  // Mantém o índice global sincronizado se o e-mail mudou.
  if (email !== user.email) {
    updateAdminEmail(user.email, email, req.tenantSlug);
  }

  if (role !== normalizeRole(user.role)) logActivity(req.admin.name || req.admin.email, 'alterou permissão de usuário', `${name}: ${normalizeRole(user.role)} → ${role}`);
  else if (status !== user.status) logActivity(req.admin.name || req.admin.email, 'alterou situação de usuário', `${name}: ${user.status} → ${status}`);
  else logActivity(req.admin.name || req.admin.email, 'editou usuário', name);
  res.json(publicView(db.prepare('SELECT * FROM admins WHERE id = ?').get(id)));
});

// GET /api/users/:id/access
router.get('/:id/access', (req, res) => {
  const id   = Number(req.params.id);
  const user = db.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const events     = db.prepare('SELECT id, name, event_date, status FROM events WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  const accessRows = db.prepare('SELECT * FROM event_access WHERE user_id = ?').all(id);
  const byEvent    = new Map(accessRows.map((a) => [a.event_id, a]));
  const list = events.map((e) => {
    const a = byEvent.get(e.id);
    const perms = {};
    for (const k of PERM_KEYS) perms[k] = !!(a && a[k]);
    return { id: e.id, name: e.name, event_date: e.event_date, status: e.status, perms };
  });
  res.json({ user: publicView(user), role: normalizeRole(user.role), defaults: defaultPermsForRole(user.role), permKeys: PERM_KEYS, events: list });
});

// PUT /api/users/:id/access
router.put('/:id/access', (req, res) => {
  const id   = Number(req.params.id);
  const user = db.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const items        = Array.isArray(req.body?.items) ? req.body.items : [];
  const validEventIds = new Set(db.prepare('SELECT id FROM events WHERE deleted_at IS NULL').all().map((e) => e.id));

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM event_access WHERE user_id = ?').run(id);
    const cols = PERM_KEYS.join(', ');
    const ph   = PERM_KEYS.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO event_access (user_id, event_id, ${cols}) VALUES (?, ?, ${ph})`);
    let count = 0;
    for (const it of items) {
      const eid = Number(it.event_id);
      if (!validEventIds.has(eid)) continue;
      const vals = PERM_KEYS.map((k) => (it[k] ? 1 : 0));
      if (!vals[PERM_KEYS.indexOf('can_view')]) continue;
      stmt.run(id, eid, ...vals);
      count++;
    }
    return count;
  });
  const count = replace();
  logActivity(req.admin.name || req.admin.email, 'alterou acesso a eventos de usuário',
    `${user.name}: ${count} evento(s) autorizado(s)`);
  res.json({ ok: true, count });
});

// POST /api/users/:id/approve
router.post('/:id/approve', (req, res) => {
  const id   = Number(req.params.id);
  const info = db.prepare("UPDATE admins SET status = 'ativo' WHERE id = ? AND deleted_at IS NULL").run(id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(publicView(db.prepare('SELECT * FROM admins WHERE id = ?').get(id)));
});

// POST /api/users/:id/reject
router.post('/:id/reject', (req, res) => {
  const id   = Number(req.params.id);
  const info = db.prepare("UPDATE admins SET status = 'recusado' WHERE id = ? AND deleted_at IS NULL").run(id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const user = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  // Remove do índice global (conta recusada não deve conseguir login).
  if (user) unregisterAdminEmail(user.email);
  res.json(publicView(user));
});

// POST /api/users/:id/password
router.post('/:id/password', (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ? AND deleted_at IS NULL').run(hash, id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const alvo = db.prepare('SELECT name FROM admins WHERE id = ?').get(id);
  logActivity(req.admin.name || req.admin.email, 'alterou senha de usuário', alvo ? alvo.name : `#${id}`);
  res.json({ ok: true, message: 'Senha redefinida.' });
});

// DELETE /api/users/:id — move o usuário para a LIXEIRA (soft-delete).
// A conta fica guardada por 90 dias antes da remoção definitiva. O login é
// bloqueado na hora (e-mail sai do índice global), mas dá para restaurar.
// As permissões por evento (event_access) são preservadas para a restauração.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) {
    return res.status(409).json({ error: 'Você não pode excluir a própria conta.' });
  }
  const user = db.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.role === 'admin' && user.status === 'ativo' && countActiveAdmins() <= 1) {
    return res.status(409).json({ error: 'Não é possível excluir o último administrador ativo.' });
  }
  db.prepare("UPDATE admins SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?")
    .run(req.admin.name || req.admin.email, id);

  // Bloqueia o login imediatamente: tira o e-mail do índice global de roteamento.
  unregisterAdminEmail(user.email);

  logActivity(req.admin.name || req.admin.email, 'moveu usuário para a lixeira', user.name);
  res.json({ ok: true });
});

module.exports = router;
