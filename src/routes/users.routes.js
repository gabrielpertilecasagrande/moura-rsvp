const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();

// Todas as rotas exigem login + papel de administrador.
router.use(requireAuth, requireAdmin);

const publicView = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  created_at: u.created_at,
});

const VALID_ROLES = ['admin', 'editor'];
const VALID_STATUS = ['pendente', 'ativo', 'recusado', 'inativo'];

function countActiveAdmins() {
  return db
    .prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND status = 'ativo'")
    .get().n;
}

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
  const r = VALID_ROLES.includes(role) ? role : 'editor';
  const mail = String(email).toLowerCase().trim();
  if (db.prepare('SELECT id FROM admins WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db
    .prepare(`INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'ativo')`)
    .run(String(name).trim(), mail, hash, r);
  const created = db.prepare('SELECT * FROM admins WHERE id = ?').get(info.lastInsertRowid);
  logActivity(req.admin.name || req.admin.email, 'criou usuário', created.name);
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
  const role = VALID_ROLES.includes(b.role) ? b.role : user.role;
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
  res.json(publicView(db.prepare('SELECT * FROM admins WHERE id = ?').get(id)));
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
  if (!password) {
    return res.status(400).json({ error: 'Informe a nova senha.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
  if (!info.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
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
  logActivity(req.admin.name || req.admin.email, 'excluiu usuário', user.name);
  res.json({ ok: true });
});

module.exports = router;
