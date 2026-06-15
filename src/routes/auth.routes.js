const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, requireAuth } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(String(email).toLowerCase());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  if (admin.status === 'pendente') {
    return res.status(403).json({ error: 'Sua conta ainda está aguardando aprovação de um administrador.' });
  }
  if (admin.status === 'bloqueado') {
    return res.status(403).json({ error: 'Sua conta foi bloqueada. Procure um administrador.' });
  }
  if (admin.status !== 'ativo') {
    return res.status(403).json({ error: 'Esta conta está desativada. Procure um administrador.' });
  }
  db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);
  logActivity(admin.name || admin.email, 'fez login', null);
  res.json({
    token: sign(admin),
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
});

// POST /api/auth/register  — solicitação de acesso (entra como 'pendente')
router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });
  }
  const mail = String(email).toLowerCase().trim();
  const exists = db.prepare('SELECT id FROM admins WHERE email = ?').get(mail);
  if (exists) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  db.prepare(
    `INSERT INTO admins (name, email, password_hash, role, status)
     VALUES (?, ?, ?, 'operador', 'pendente')`
  ).run(String(name).trim(), mail, hash);
  res.status(201).json({
    ok: true,
    message: 'Solicitação enviada. Um administrador precisa aprovar seu acesso antes do primeiro login.',
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

// PUT /api/auth/profile — o próprio usuário edita nome e e-mail
router.put('/profile', requireAuth, (req, res) => {
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Conta não encontrada.' });
  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : admin.name;
  const email = b.email != null ? String(b.email).toLowerCase().trim() : admin.email;
  if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }
  if (email !== admin.email && db.prepare('SELECT id FROM admins WHERE email = ? AND id <> ?').get(email, admin.id)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }
  db.prepare('UPDATE admins SET name = ?, email = ? WHERE id = ?').run(name, email, admin.id);
  logActivity(name || email, 'atualizou o próprio perfil', null);
  // Reemite o token para refletir nome/e-mail/perfil atualizados imediatamente.
  const fresh = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
  res.json({ ok: true, token: sign(fresh), admin: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role } });
});

// POST /api/auth/password — o próprio usuário troca a senha (precisa da senha atual)
router.post('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres.' });
  }
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (!bcrypt.compareSync(String(current_password), admin.password_hash)) {
    return res.status(401).json({ error: 'A senha atual está incorreta.' });
  }
  if (bcrypt.compareSync(String(new_password), admin.password_hash)) {
    return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
  }
  const hash = bcrypt.hashSync(String(new_password), 10);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, admin.id);
  logActivity(admin.name || admin.email, 'alterou a própria senha', null);
  res.json({ ok: true, message: 'Senha alterada com sucesso.' });
});

module.exports = router;
