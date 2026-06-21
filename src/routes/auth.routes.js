'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../db');
const { sign, requireAuth, SECRET } = require('../middleware/auth');
const { openTenantDb, runWithDb }   = require('../db');
const { logActivity }               = require('../utils/activity');
const { normalizeRole }             = require('../utils/permissions');
const { uniqueSlug }                = require('../utils/slug');
const { parseFormConfig }           = require('../utils/formConfig');
const {
  findTenantByEmail,
  registerAdminEmail,
  unregisterAdminEmail,
  updateAdminEmail,
} = require('../router');
const { createRefreshToken, useRefreshToken, revokeRefreshToken, listSessions, revokeOtherSessions, pruneExpiredSessions } = require('../utils/sessions');

const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Slug do tenant padrão (Moura) para rotas de integração legadas.
// Em multi-tenant futuro, essas rotas passarão o slug explicitamente.
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_SLUG || 'moura';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  const mail = String(email).toLowerCase().trim();

  // Descobre a qual organização este admin pertence.
  const ref = findTenantByEmail(mail);
  if (!ref) {
    // Resposta genérica: não revela se o e-mail existe.
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  const tenantDb = openTenantDb(ref.tenant_slug);
  const admin = tenantDb.prepare('SELECT * FROM admins WHERE email = ?').get(mail);
  if (!admin || !bcrypt.compareSync(String(password), admin.password_hash)) {
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

  // Registra o último login e a atividade dentro do contexto do tenant.
  runWithDb(ref.tenant_slug, () => {
    db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);
    logActivity(admin.name || admin.email, 'fez login', null);
  });
  pruneExpiredSessions();

  res.json({
    token: sign(admin, ref.tenant_slug),
    // Login persistente (app/PWA): o cliente guarda o refresh token e renova a
    // sessão sozinho, sem pedir senha de novo entre aberturas do app.
    refresh_token: createRefreshToken(ref.tenant_slug, admin.id, req.headers['user-agent']),
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  });
});

// GET /api/auth/sso?token=TEMP_JWT&event=EVENT_ID
// Login automático vindo de um sistema externo (integração Moura One).
// Em multi-tenant, o evento e o usuário pertencem ao tenant padrão (DEFAULT_TENANT).
router.get('/sso', (req, res) => {
  const { token, event } = req.query || {};
  const fail = () => res.redirect('/admin/login.html?sso=erro');
  if (!token) return fail();

  let payload;
  try { payload = jwt.verify(String(token), SECRET); } catch { return fail(); }
  if (payload.target !== 'rsvp') return fail();

  const email = String(payload.email || '').toLowerCase().trim();
  if (!email) return fail();

  const tenantDb = openTenantDb(DEFAULT_TENANT);
  const admin = tenantDb.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || admin.status !== 'ativo') return fail();

  runWithDb(DEFAULT_TENANT, () => {
    db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);
    logActivity(admin.name || admin.email, 'entrou via SSO (integração)', null);

    const { randomUUID } = require('crypto');
    const ref = randomUUID();
    const sessionToken = sign(admin, DEFAULT_TENANT);
    // Login persistente também para quem entra via SSO (integração Moura One).
    const refreshToken = createRefreshToken(DEFAULT_TENANT, admin.id, req.headers['user-agent']);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    db.prepare(
      'INSERT INTO sso_sessions (ref, token, refresh_token, event_id, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ref, sessionToken, refreshToken, event ? String(event) : null, expiresAt);

    return res.redirect(`/admin/sso-landing.html?ref=${encodeURIComponent(ref)}`);
  });
});

// GET /api/auth/sso-session?ref=UUID
// Troca o ref opaco pelo token de sessão real (uso único, expira em 60 s).
router.get('/sso-session', (req, res) => {
  const ref = String(req.query.ref || '').trim();
  if (!ref) return res.status(400).json({ error: 'ref ausente.' });

  // SSO sessions pertencem ao tenant padrão.
  const tenantDb = openTenantDb(DEFAULT_TENANT);
  const row = tenantDb.prepare('SELECT * FROM sso_sessions WHERE ref = ?').get(ref);
  if (!row) return res.status(404).json({ error: 'Sessão não encontrada.' });
  if (row.used_at) return res.status(410).json({ error: 'Sessão já utilizada.' });
  if (row.expires_at < new Date().toISOString()) return res.status(410).json({ error: 'Sessão expirada.' });

  tenantDb.prepare("UPDATE sso_sessions SET used_at = datetime('now') WHERE ref = ?").run(ref);
  res.json({ token: row.token, refresh_token: row.refresh_token || null, event_id: row.event_id || null });
});

// POST /api/auth/register — solicitação de acesso (conta fica como 'pendente')
// O tenant é lido de X-Tenant-Slug ou DEFAULT_TENANT (backward-compat com Moura).
router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });
  }
  const mail = String(email).toLowerCase().trim();
  const tenantSlug = String(req.headers['x-tenant-slug'] || DEFAULT_TENANT);

  const tenantDb = openTenantDb(tenantSlug);
  if (tenantDb.prepare('SELECT id FROM admins WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  tenantDb.prepare(
    "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, 'operador', 'pendente')"
  ).run(String(name).trim(), mail, hash);

  // Registra no índice global para que o login funcione quando aprovada.
  registerAdminEmail(mail, tenantSlug);

  res.status(201).json({
    ok: true,
    message: 'Solicitação enviada. Um administrador precisa aprovar seu acesso antes do primeiro login.',
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

// POST /api/auth/refresh — troca o refresh token por um novo JWT de acesso.
// Mantém o usuário logado entre sessões sem digitar senha. NÃO usa requireAuth:
// valida o próprio refresh token (o JWT de acesso pode já ter expirado). O tenant
// é descoberto pela própria linha do refresh token (índice global).
router.post('/refresh', (req, res) => {
  const plain = String((req.body || {}).refresh_token || '').trim();
  if (!plain) return res.status(401).json({ error: 'Sessão encerrada. Entre novamente.' });
  const result = useRefreshToken(plain);
  if (!result) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  res.json({
    token: sign(result.user, result.tenantSlug),
    // Mesmo refresh token (não rotaciona) — devolvido por conveniência do cliente.
    refresh_token: plain,
    admin: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
  });
});

// POST /api/auth/logout — encerra a sessão persistente (revoga o refresh token).
// Idempotente: sempre responde ok, mesmo sem token (logout local já basta).
router.post('/logout', (req, res) => {
  const plain = String((req.body || {}).refresh_token || '').trim();
  if (plain) revokeRefreshToken(plain);
  res.json({ ok: true });
});

// GET /api/auth/sessions — lista os aparelhos conectados (sessões ativas) do
// usuário, no seu tenant. O cliente envia o refresh token no header
// X-Refresh-Token para marcar "este aparelho" (o token nunca vai na URL).
router.get('/sessions', requireAuth, (req, res) => {
  res.json({ sessions: listSessions(req.admin.id, req.tenantSlug, req.headers['x-refresh-token'] || null) });
});

// POST /api/auth/sessions/revoke-others — desconecta TODOS os outros aparelhos na
// hora: revoga os refresh tokens deles e invalida os JWTs de acesso já emitidos.
// Mantém este aparelho logado (preserva o refresh token enviado e reemite o JWT).
router.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const keep = String((req.body || {}).refresh_token || '').trim() || null;
  revokeOtherSessions(req.admin.id, req.tenantSlug, keep);
  db.prepare("UPDATE admins SET sessions_invalidated_at = strftime('%s','now') WHERE id = ?").run(req.admin.id);
  logActivity(req.admin.name || req.admin.email, 'desconectou os outros aparelhos', null);
  res.json({ ok: true, token: sign(req.admin, req.tenantSlug) });
});

// PUT /api/auth/profile — o próprio usuário edita nome e e-mail
router.put('/profile', requireAuth, (req, res) => {
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Conta não encontrada.' });
  const b = req.body || {};
  const name  = b.name  != null ? String(b.name).trim()               : admin.name;
  const email = b.email != null ? String(b.email).toLowerCase().trim() : admin.email;
  if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }
  if (email !== admin.email && db.prepare('SELECT id FROM admins WHERE email = ? AND id <> ?').get(email, admin.id)) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }

  db.prepare('UPDATE admins SET name = ?, email = ? WHERE id = ?').run(name, email, admin.id);

  // Atualiza o índice global se o e-mail mudou.
  if (email !== admin.email) {
    updateAdminEmail(admin.email, email, req.tenantSlug);
  }

  logActivity(name || email, 'atualizou o próprio perfil', null);
  const fresh = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
  res.json({
    ok: true,
    token: sign(fresh, req.tenantSlug),
    admin: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role },
  });
});

// POST /api/auth/password — o próprio usuário troca a senha
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

// POST /api/auth/sync-user — upsert de conta a partir de sistema externo (serviço Moura One).
// Autenticado pelo segredo compartilhado (Authorization: Bearer <JWT_SECRET>).
// Usa DEFAULT_TENANT: integração legada, sempre sincroniza para o tenant Moura.
router.post('/sync-user', (req, res) => {
  const secret = process.env.JWT_SECRET;
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secret || !token || !safeEqual(token, secret)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const { name, email, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
  const mail = String(email).toLowerCase().trim();
  const r    = normalizeRole(role);
  const n    = name ? String(name).trim() : mail;

  const tenantDb = openTenantDb(DEFAULT_TENANT);
  const existing = tenantDb.prepare('SELECT id FROM admins WHERE email = ?').get(mail);
  if (existing) {
    tenantDb.prepare('UPDATE admins SET name = ?, role = ? WHERE email = ?').run(n, r, mail);
    runWithDb(DEFAULT_TENANT, () => logActivity('integração (sync)', 'atualizou usuário', mail));
    return res.json({ ok: true, action: 'updated' });
  }
  const randomPwd = crypto.randomBytes(32).toString('hex');
  const hash = bcrypt.hashSync(randomPwd, 10);
  tenantDb.prepare(
    "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'ativo')"
  ).run(n, mail, hash, r);
  registerAdminEmail(mail, DEFAULT_TENANT);
  runWithDb(DEFAULT_TENANT, () => logActivity('integração (sync)', 'criou usuário', mail));
  res.status(201).json({ ok: true, action: 'created' });
});

// POST /api/auth/provision-event — cria evento a partir de sistema externo.
// Autenticado pelo segredo compartilhado. Usa DEFAULT_TENANT (integração legada).
// Aceita tenant_slug no corpo para direcionamento explícito em cenários futuros.
router.post('/provision-event', (req, res) => {
  const secret = process.env.JWT_SECRET;
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secret || !token || !safeEqual(token, secret)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });
  const tenantSlug = String(b.tenant_slug || DEFAULT_TENANT);

  const { registerEventSlug } = require('../router');

  runWithDb(tenantSlug, () => {
    const slug       = uniqueSlug(db, b.slug && String(b.slug).trim() ? b.slug : b.name);
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
    registerEventSlug(created.slug, tenantSlug);

    const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    logActivity('integração (provision)', 'criou evento', created.name);
    res.status(201).json({ id: created.id, slug: created.slug, public_url: `${base}/rsvp/${created.slug}` });
  });
});

module.exports = router;
