const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const { PERM_KEYS, normalizeRole, defaultPermsForRole } = require('../utils/permissions');

// Sincroniza um usuário com o RSVP de forma silenciosa (não bloqueia a resposta).
function syncToRsvp(name, email, role) {
  const url = process.env.RSVP_API_URL;
  const secret = process.env.RSVP_JWT_SECRET;
  if (!url || !secret) return;
  fetch(`${url}/api/auth/sync-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ name, email, role }),
  }).catch(() => {}); // silencioso: RSVP indisponível não afeta o Moura One
}

const router = express.Router();

// Todas as rotas exigem login + papel de administrador.
router.use(requireAuth, requireAdmin);

const publicView = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: normalizeRole(u.role),
  status: u.status,
  created_at: u.created_at,
  last_login: u.last_login,
});

const VALID_ROLES = ['admin', 'gestor', 'operador'];
const VALID_STATUS = ['pendente', 'ativo', 'recusado', 'inativo', 'bloqueado'];

function countActiveAdmins() {
  return db
    .prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND status = 'ativo'")
    .get().n;
}

// GET /api/users/pending-count — quantas solicitações de acesso aguardam aprovação
router.get('/pending-count', (_req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM admins WHERE status = 'pendente'").get().n;
  res.json({ count });
});

// GET /api/users — lista todos os usuários
router.get('/', (_req, res) => {
  const rows = db.prepare(
    "SELECT * FROM admins ORDER BY (status = 'pendente') DESC, name COLLATE NOCASE"
  ).all();
  res.json(rows.map(publicView));
});

// POST /api/users — cria usuário já ativo
router.post('/', (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  }
  const r = VALID_ROLES.includes(role) ? role : 'operador';
  const mail = String(email).toLowerCase().trim();
  if (db.prepare('SELECT id FROM admins WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db
    .prepare(`INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'ativo')`)
    .run(String(name).trim(), mail, hash, r);
  const created = db.prepare('SELECT * FROM admins WHERE id = ?').get(info.lastInsertRowid);
  logActivity(req.admin.name || req.admin.email, 'criou usuário', created.name);
  syncToRsvp(created.name, created.email, created.role);
  res.status(201).json(publicView(created));
});

// PUT /api/users/:id — altera nome, e-mail, papel e/ou status
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : user.name;
  const email = b.email != null ? String(b.email).toLowerCase().trim() : user.email;
  const role = VALID_ROLES.includes(b.role) ? b.role : normalizeRole(user.role);
  const status = VALID_STATUS.includes(b.status) ? b.status : user.status;

  if (email !== user.email && db.prepare('SELECT id FROM admins WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }

  // Proteção: não deixar o sistema sem nenhum administrador ativo.
  const wasActiveAdmin = user.role === 'admin' && user.status === 'ativo';
  const willBeActiveAdmin = role === 'admin' && status === 'ativo';
  if (wasActiveAdmin && !willBeActiveAdmin && countActiveAdmins() <= 1) {
    return res.status(409).json({ error: 'Não é possível remover o último administrador ativo do sistema.' });
  }

  db.prepare('UPDATE admins SET name = ?, email = ?, role = ?, status = ? WHERE id = ?').run(
    name, email, role, status, id
  );
  if (role !== normalizeRole(user.role)) logActivity(req.admin.name || req.admin.email, 'alterou permissão de usuário', `${name}: ${normalizeRole(user.role)} → ${role}`);
  else if (status !== user.status) logActivity(req.admin.name || req.admin.email, 'alterou situação de usuário', `${name}: ${user.status} → ${status}`);
  else logActivity(req.admin.name || req.admin.email, 'editou usuário', name);
  syncToRsvp(name, email, role);
  res.json(publicView(db.prepare('SELECT * FROM admins WHERE id = ?').get(id)));
});

// GET /api/users/:id/access — lista todos os eventos com a permissão atual do usuário
router.get('/:id/access', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const events = db.prepare('SELECT id, name, event_date, status FROM events ORDER BY created_at DESC').all();
  const accessRows = db.prepare('SELECT * FROM event_access WHERE user_id = ?').all(id);
  const byEvent = new Map(accessRows.map((a) => [a.event_id, a]));
  const list = events.map((e) => {
    const a = byEvent.get(e.id);
    const perms = {};
    for (const k of PERM_KEYS) perms[k] = !!(a && a[k]);
    return { id: e.id, name: e.name, event_date: e.event_date, status: e.status, perms };
  });
  res.json({
    user: publicView(user),
    role: normalizeRole(user.role),
    defaults: defaultPermsForRole(user.role),
    permKeys: PERM_KEYS,
    events: list,
  });
});

// PUT /api/users/:id/access — define os eventos autorizados e as permissões do usuário
// Body: { items: [{ event_id, can_view, can_edit, ... }] }
router.put('/:id/access', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const validEventIds = new Set(db.prepare('SELECT id FROM events').all().map((e) => e.id));

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM event_access WHERE user_id = ?').run(id);
    const cols = PERM_KEYS.join(', ');
    const ph = PERM_KEYS.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO event_access (user_id, event_id, ${cols}) VALUES (?, ?, ${ph})`);
    let count = 0;
    for (const it of items) {
      const eid = Number(it.event_id);
      if (!validEventIds.has(eid)) continue;
      const vals = PERM_KEYS.map((k) => (it[k] ? 1 : 0));
      // Sem "visualizar" não há acesso: ignora a linha inteira.
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

// POST /api/users/:id/approve — aprova conta pendente
router.post('/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("UPDATE admins SET status = 'ativo' WHERE id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(publicView(db.prepare('SELECT * FROM admins WHERE id = ?').get(id)));
});

// POST /api/users/:id/reject — recusa conta pendente
router.post('/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("UPDATE admins SET status = 'recusado' WHERE id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(publicView(db.prepare('SELECT * FROM admins WHERE id = ?').get(id)));
});

// POST /api/users/:id/password — redefine a senha
router.post('/:id/password', (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const alvo = db.prepare('SELECT name FROM admins WHERE id = ?').get(id);
  logActivity(req.admin.name || req.admin.email, 'alterou senha de usuário', alvo ? alvo.name : `#${id}`);
  res.json({ ok: true, message: 'Senha redefinida.' });
});

// DELETE /api/users/:id — exclui usuário
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) {
    return res.status(409).json({ error: 'Você não pode excluir a própria conta.' });
  }
  const user = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.role === 'admin' && user.status === 'ativo' && countActiveAdmins() <= 1) {
    return res.status(409).json({ error: 'Não é possível excluir o último administrador ativo.' });
  }
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  db.prepare('DELETE FROM event_access WHERE user_id = ?').run(id);
  logActivity(req.admin.name || req.admin.email, 'excluiu usuário', user.name);
  res.json({ ok: true });
});

module.exports = router;
