const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { sign, requireAuth, SECRET } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const { normalizeRole } = require('../utils/permissions');
const { uniqueSlug } = require('../utils/slug');
const { parseFormConfig } = require('../utils/formConfig');

const router = express.Router();

// Comparação em tempo constante (evita vazar o segredo por tempo de resposta).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

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

// GET /api/auth/sso?token=TEMP_JWT&event=EVENT_ID
// Login automático (SSO) vindo do Moura One. O `token` é um JWT temporário e
// curto, assinado com o MESMO JWT_SECRET compartilhado entre os dois sistemas.
// Reusa sign()/logActivity() já existentes; emite uma sessão normal do RSVP.
router.get('/sso', (req, res) => {
  const { token, event } = req.query || {};
  const fail = () => res.redirect('/admin/login.html?sso=erro');
  if (!token) return fail();
  let payload;
  try { payload = jwt.verify(String(token), SECRET); } catch { return fail(); }
  // O token de handshake DEVE declarar target:'rsvp' (definido no Moura One).
  if (payload.target !== 'rsvp') return fail();
  const email = String(payload.email || '').toLowerCase().trim();
  if (!email) return fail();
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || admin.status !== 'ativo') return fail();
  db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);
  logActivity(admin.name || admin.email, 'entrou via Moura One (SSO)', null);
  const ev = event ? `&event=${encodeURIComponent(String(event))}` : '';
  return res.redirect(`/admin/sso-landing.html?token=${encodeURIComponent(sign(admin))}${ev}`);
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

// POST /api/auth/sync-user — provisionamento interno de conta, chamado pelo
// Moura One ao criar/editar um usuário, para a mesma pessoa existir nos dois
// sistemas. Autenticado pelo SEGREDO COMPARTILHADO (Authorization: Bearer
// <JWT_SECRET>), não por sessão de usuário. Faz upsert: cria a conta (ativa, com
// senha aleatória — staff entra por SSO) ou atualiza nome/papel se já existir.
router.post('/sync-user', (req, res) => {
  const secret = process.env.JWT_SECRET;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Falha fechada: sem JWT_SECRET configurado, ninguém entra.
  if (!secret || !token || !safeEqual(token, secret)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const { name, email, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
  const mail = String(email).toLowerCase().trim();
  const r = normalizeRole(role); // admin | gestor | operador (desconhecido → operador)
  const n = name ? String(name).trim() : mail;

  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(mail);
  if (existing) {
    db.prepare('UPDATE admins SET name = ?, role = ? WHERE email = ?').run(n, r, mail);
    logActivity('Moura One (sync)', 'atualizou usuário via integração', mail);
    return res.json({ ok: true, action: 'updated' });
  }
  const randomPwd = crypto.randomBytes(32).toString('hex');
  const hash = bcrypt.hashSync(randomPwd, 10);
  db.prepare(
    "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'ativo')"
  ).run(n, mail, hash, r);
  logActivity('Moura One (sync)', 'criou usuário via integração', mail);
  res.status(201).json({ ok: true, action: 'created' });
});

// POST /api/auth/provision-event — criação de evento no RSVP a partir do Moura One.
// O Moura One é o sistema central: quando o usuário marca "Criar no RSVP" ao
// cadastrar um evento, ele chama esta rota para gerar o evento-clone aqui.
// Autenticado pelo SEGREDO COMPARTILHADO (Authorization: Bearer <JWT_SECRET>),
// não por sessão de usuário. Espelha exatamente o INSERT de POST /api/events
// (mesmas colunas e defaults), então é seguro quanto ao schema. Retorna o `id`
// (que o Moura One guarda como rsvp_event_id), o `slug` e a `public_url` do convite.
router.post('/provision-event', (req, res) => {
  const secret = process.env.JWT_SECRET;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Falha fechada: sem JWT_SECRET configurado, ninguém entra.
  if (!secret || !token || !safeEqual(token, secret)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });

  const slug = uniqueSlug(db, b.slug && String(b.slug).trim() ? b.slug : b.name);
  const formConfig = JSON.stringify(parseFormConfig(b.form_config));

  const info = db.prepare(`
    INSERT INTO events (slug, name, description, event_date, event_time, location, city, address,
      cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
      expected_guests, whatsapp, whatsapp_enabled, force_open, form_config)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    slug, String(b.name).trim(), b.description || null, b.event_date || null, b.event_time || null,
    b.location || null, b.city || null, b.address || null, null, null, b.rsvp_deadline || null, 'ativo',
    b.confirm_message || 'Olá, {nome}. Sua presença no evento foi confirmada com sucesso.',
    b.decline_message || 'Olá, {nome}. Registramos sua impossibilidade de participação no evento. Agradecemos seu retorno.',
    parseInt(b.expected_guests, 10) || 0, b.whatsapp || null, 1, 0, formConfig
  );

  const created = db.prepare('SELECT id, slug, name FROM events WHERE id = ?').get(info.lastInsertRowid);
  const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const public_url = `${base}/rsvp/${created.slug}`;
  logActivity('Moura One (integração)', 'criou evento via integração', created.name);
  res.status(201).json({ id: created.id, slug: created.slug, public_url });
});

module.exports = router;
