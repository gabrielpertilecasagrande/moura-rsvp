'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const QRCode  = require('qrcode');
const db      = require('../db');
const { sign, signMfa, requireAuth, SECRET } = require('../middleware/auth');
const { openTenantDb, runWithDb }   = require('../db');
const totp                          = require('../utils/totp');
const { encrypt, decrypt }          = require('../utils/crypto');
const { logActivity }               = require('../utils/activity');
const { normalizeRole }             = require('../utils/permissions');
const { uniqueSlug }                = require('../utils/slug');
const { parseFormConfig }           = require('../utils/formConfig');
const { genRefCode }                = require('../utils/refCode');
const {
  findTenantByEmail,
  registerAdminEmail,
  unregisterAdminEmail,
  updateAdminEmail,
  organizationExists,
} = require('../router');
const { createRefreshToken, useRefreshToken, revokeRefreshToken, listSessions, enrichSessionsCity, revokeOtherSessions, revokeSessionById, pruneExpiredSessions } = require('../utils/sessions');

// IP do cliente (atrás do proxy do Railway, o real vem no x-forwarded-for).
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || req.ip || null;
}

const router = express.Router();

// Hash fixo (de uma senha aleatória) usado só para gastar o mesmo tempo de
// verificação quando o e-mail não existe — defesa contra enumeração por timing.
const DUMMY_HASH = bcrypt.hashSync('senha-inexistente-para-timing', 10);

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
    // Roda um bcrypt "no vazio" para igualar o tempo de resposta ao do caminho
    // com e-mail existente — evita descobrir contas por diferença de tempo.
    bcrypt.compareSync(String(password), DUMMY_HASH);
    // Resposta genérica: não revela se o e-mail existe.
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  const tenantDb = openTenantDb(ref.tenant_slug);
  const admin = tenantDb.prepare('SELECT * FROM admins WHERE email = ?').get(mail);
  if (!admin || admin.deleted_at || !bcrypt.compareSync(String(password), admin.password_hash)) {
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

  // Verificação em duas etapas ativa: senha correta não basta. Emite token
  // intermediário (5 min) carregando o tenant e pede o código; a sessão sai no
  // /2fa/verify.
  if (admin.totp_enabled) {
    return res.json({ mfa_required: true, mfa_token: signMfa(admin.id, ref.tenant_slug) });
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
    refresh_token: createRefreshToken(ref.tenant_slug, admin.id, req.headers['user-agent'], clientIp(req)),
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
  if (!admin || admin.deleted_at || admin.status !== 'ativo') return fail();

  runWithDb(DEFAULT_TENANT, () => {
    db.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);
    logActivity(admin.name || admin.email, 'entrou via SSO (integração)', null);

    const { randomUUID } = require('crypto');
    const ref = randomUUID();
    const sessionToken = sign(admin, DEFAULT_TENANT);
    // Login persistente também para quem entra via SSO (integração Moura One).
    const refreshToken = createRefreshToken(DEFAULT_TENANT, admin.id, req.headers['user-agent'], clientIp(req));
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
  const tenantSlug = String(req.headers['x-tenant-slug'] || DEFAULT_TENANT).toLowerCase().trim();

  // Só aceita solicitação para uma organização que JÁ existe. Sem isto, qualquer
  // pessoa poderia criar bancos de tenant arbitrários (enchendo o disco) só
  // mandando um header X-Tenant-Slug diferente.
  if (!organizationExists(tenantSlug)) {
    return res.status(400).json({ error: 'Organização inválida.' });
  }

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
router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = await enrichSessionsCity(listSessions(req.admin.id, req.tenantSlug, req.headers['x-refresh-token'] || null));
  res.json({ sessions });
});

// POST /api/auth/sessions/:id/revoke — remove um aparelho específico da lista
// (revoga o refresh token daquela sessão; ela some da lista na hora).
router.post('/sessions/:id/revoke', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Sessão inválida.' });
  revokeSessionById(req.admin.id, req.tenantSlug, id);
  res.json({ ok: true });
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
  const { name, email, role, status, deleted, password_hash } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
  const mail = String(email).toLowerCase().trim();
  const r    = normalizeRole(role);
  const n    = name ? String(name).trim() : mail;
  // Senha única: o Moura One pode enviar o hash bcrypt da senha para que a mesma
  // senha valha aqui. Aceita só hash bcrypt válido (nunca senha em texto puro).
  const pwHash = (typeof password_hash === 'string' && /^\$2[aby]\$/.test(password_hash)) ? password_hash : null;
  // Espelha a situação vinda do Moura One. 'deleted' revoga o acesso (inativo).
  // Mapeamento: ativo→ativo, bloqueado→bloqueado, demais (inativo/recusado/
  // pendente)→inativo. Assim bloquear/excluir lá também bloqueia o login aqui.
  function mirrorStatus(s) {
    if (deleted) return 'inativo';
    const v = String(s || '').toLowerCase();
    if (v === 'ativo') return 'ativo';
    if (v === 'bloqueado') return 'bloqueado';
    if (v === 'inativo' || v === 'recusado' || v === 'pendente') return 'inativo';
    return null; // não informado → não altera
  }
  const newStatus = mirrorStatus(status);

  const tenantDb = openTenantDb(DEFAULT_TENANT);
  const existing = tenantDb.prepare('SELECT id FROM admins WHERE email = ?').get(mail);
  if (existing) {
    // Monta o UPDATE incluindo status e/ou senha apenas quando informados.
    const sets = ['name = ?', 'role = ?', 'source = ?'];
    const vals = [n, r, 'moura_one'];
    if (newStatus) { sets.push('status = ?'); vals.push(newStatus); }
    if (pwHash && !deleted) { sets.push('password_hash = ?'); vals.push(pwHash); }
    vals.push(mail);
    tenantDb.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE email = ?`).run(...vals);
    const act = deleted ? 'revogou usuário' : 'atualizou usuário';
    runWithDb(DEFAULT_TENANT, () => logActivity('integração (sync)', act, mail));
    return res.json({ ok: true, action: deleted ? 'revoked' : 'updated' });
  }
  // Pedido de exclusão para conta inexistente aqui: nada a fazer.
  if (deleted) return res.json({ ok: true, action: 'noop' });
  // Usa o hash enviado (senha única) ou, na falta, uma senha aleatória — o
  // acesso real virá por SSO ou por "Esqueci a senha".
  const hash = pwHash || bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  tenantDb.prepare(
    'INSERT INTO admins (name, email, password_hash, role, status, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(n, mail, hash, r, newStatus || 'ativo', 'moura_one');
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
  const tenantSlug = String(b.tenant_slug || DEFAULT_TENANT).toLowerCase().trim();

  // O tenant precisa já existir — provisionar evento não cria organização nova
  // (isso é papel das rotas de plataforma). Evita criar bancos arbitrários.
  if (!organizationExists(tenantSlug)) {
    return res.status(404).json({ error: 'Organização não encontrada.' });
  }

  const { registerEventSlug } = require('../router');
  // ID do evento no Moura One (fonte da verdade) e o ID conhecido deste evento no
  // RSVP (quando o Moura One já o tem mapeado) — usados para localizar e atualizar
  // em vez de duplicar.
  const src     = b.source_event_id != null ? String(b.source_event_id) : null;
  const knownId = b.event_id != null ? Number(b.event_id) : null;

  runWithDb(tenantSlug, () => {
    const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const publicUrl = (e) => `${base}/rsvp/${e.slug}`;

    // Atualiza APENAS os campos que o Moura One é dono (núcleo do evento).
    // NÃO toca em campos próprios do RSVP: slug, mensagens, prazo, form_config,
    // whatsapp, status, capa/logo — para não sobrescrever ajustes locais.
    const syncCore = (id) => {
      db.prepare(
        `UPDATE events SET name = ?, event_date = ?, event_time = ?, location = ?, city = ?,
                updated_at = datetime('now') WHERE id = ?`
      ).run(String(b.name).trim(), b.event_date || null, b.event_time || null,
            b.location || null, b.city || null, id);
    };

    // Promove ref_code de AV- para MO- quando evento avulso é vinculado ao Moura One.
    const promoteRefCode = (eventId, currentCode) => {
      if (!currentCode || currentCode.startsWith('AV-')) {
        const moCode = genRefCode(db, 'MO');
        db.prepare('UPDATE events SET ref_code = ? WHERE id = ?').run(moCode, eventId);
        return moCode;
      }
      return currentCode;
    };

    // 1) Já vinculado pela origem (source_event_id) → atualiza.
    if (src) {
      const ex = db.prepare('SELECT id, slug, name, ref_code FROM events WHERE source_event_id = ? AND deleted_at IS NULL').get(src);
      if (ex) {
        const refCode = promoteRefCode(ex.id, ex.ref_code);
        syncCore(ex.id);
        logActivity('integração (provision)', 'atualizou evento', `${String(b.name).trim()} [${refCode} | src:${src}]`);
        return res.json({ id: ex.id, slug: ex.slug, ref_code: refCode, public_url: publicUrl(ex), updated: true });
      }
    }

    // 2) Backfill: o Moura One conhece o ID deste evento no RSVP mas ainda não
    //    havia carimbado a origem → vincula (stamp) e atualiza, sem duplicar.
    if (knownId) {
      const ex = db.prepare('SELECT id, slug, name, source_event_id, ref_code FROM events WHERE id = ? AND deleted_at IS NULL').get(knownId);
      if (ex) {
        if (src && !ex.source_event_id) db.prepare('UPDATE events SET source_event_id = ? WHERE id = ?').run(src, ex.id);
        const refCode = promoteRefCode(ex.id, ex.ref_code);
        syncCore(ex.id);
        logActivity('integração (provision)', 'vinculou e atualizou evento', `${String(b.name).trim()} [${refCode} | src:${src || '—'}]`);
        return res.json({ id: ex.id, slug: ex.slug, ref_code: refCode, public_url: publicUrl(ex), updated: true, linked: true });
      }
    }

    // 3) Não existe → cria (comportamento original), carimbando a origem.
    const slug       = uniqueSlug(db, b.slug && String(b.slug).trim() ? b.slug : b.name);
    const formConfig = JSON.stringify(parseFormConfig(b.form_config));

    // Evento criado pela integração é do Moura One → prefixo MO no código.
    const refCode = genRefCode(db, 'MO');
    const info = db.prepare(`
      INSERT INTO events (slug, name, description, event_date, event_time, location, city, address,
        cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
        expected_guests, whatsapp, whatsapp_enabled, force_open, form_config, source_event_id, ref_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      slug, String(b.name).trim(), b.description || null, b.event_date || null, b.event_time || null,
      b.location || null, b.city || null, b.address || null, null, null, b.rsvp_deadline || null, 'ativo',
      b.confirm_message || 'Olá, {nome}. Sua presença no evento foi confirmada com sucesso.',
      b.decline_message || 'Olá, {nome}. Registramos sua impossibilidade de participação no evento. Agradecemos seu retorno.',
      parseInt(b.expected_guests, 10) || 0, b.whatsapp || null, 1, 0, formConfig, src, refCode
    );

    const created = db.prepare('SELECT id, slug, name, ref_code FROM events WHERE id = ?').get(info.lastInsertRowid);
    registerEventSlug(created.slug, tenantSlug);

    logActivity('integração (provision)', 'criou evento', `${created.name} [${created.ref_code} | src:${src || '—'}]`);
    res.status(201).json({ id: created.id, slug: created.slug, ref_code: created.ref_code, public_url: publicUrl(created) });
  });
});

// ── Verificação em duas etapas (2FA por TOTP) ────────────────────────────────
const TOTP_ISSUER = 'Moura RSVP';

// Exige a chave de criptografia: sem ela, o segredo TOTP seria gravado em texto
// puro (crypto.js faz passthrough). Bloqueia a ativação até a chave existir.
function encryptionReady(res) {
  if (!process.env.DATA_ENCRYPTION_KEY) {
    res.status(503).json({ error: 'A verificação em duas etapas exige a chave de criptografia (DATA_ENCRYPTION_KEY) configurada no servidor. Procure o suporte.' });
    return false;
  }
  return true;
}

// Limitador anti força-bruta do 2º fator, por IP, em memória (admins do RSVP não
// têm colunas de lockout). 5 tentativas / 15 min → bloqueio por 15 min.
const MFA_MAX = 5;
const MFA_WINDOW_MS = 15 * 60 * 1000;
const mfaAttempts = new Map();
function mfaBlocked(ip) {
  const e = mfaAttempts.get(ip);
  if (!e) return false;
  if (Date.now() > e.until) { mfaAttempts.delete(ip); return false; }
  return e.count >= MFA_MAX;
}
function mfaFail(ip) {
  const now = Date.now();
  const e = mfaAttempts.get(ip);
  if (!e || now > e.until) mfaAttempts.set(ip, { count: 1, until: now + MFA_WINDOW_MS });
  else e.count++;
}
function mfaReset(ip) { mfaAttempts.delete(ip); }

// As rotas abaixo (exceto /verify) usam requireAuth, que já estabelece o contexto
// do tenant via ALS — então o proxy `db` aponta para o banco do tenant correto.

// GET /api/auth/2fa/status
router.get('/2fa/status', requireAuth, (req, res) => {
  const a = db.prepare('SELECT totp_enabled, totp_recovery_codes FROM admins WHERE id = ?').get(req.admin.id);
  res.json({
    enabled: !!(a && a.totp_enabled),
    recovery_remaining: a ? totp.remainingRecoveryCodes(a.totp_recovery_codes) : 0,
    encryption_ready: !!process.env.DATA_ENCRYPTION_KEY,
  });
});

// POST /api/auth/2fa/setup — gera o segredo (cifrado, ainda desligado) + QR Code.
router.post('/2fa/setup', requireAuth, async (req, res) => {
  if (!encryptionReady(res)) return;
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!a) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (a.totp_enabled) return res.status(409).json({ error: 'A verificação em duas etapas já está ativa.' });
  const secret = totp.generateSecret();
  db.prepare("UPDATE admins SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").run(encrypt(secret), a.id);
  const otpauth = totp.keyuri(a.email, TOTP_ISSUER, secret);
  const qr = await QRCode.toDataURL(otpauth);
  res.json({ otpauth_url: otpauth, qr, secret });
});

// POST /api/auth/2fa/enable — confirma o código e ativa; devolve recovery codes 1x.
router.post('/2fa/enable', requireAuth, (req, res) => {
  if (!encryptionReady(res)) return;
  const { code } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!a || !a.totp_secret) return res.status(400).json({ error: 'Inicie a configuração antes de confirmar o código.' });
  if (a.totp_enabled) return res.status(409).json({ error: 'A verificação em duas etapas já está ativa.' });
  const secret = decrypt(a.totp_secret);
  if (!totp.verifyToken(secret, code)) return res.status(400).json({ error: 'Código incorreto. Confira no app e tente novamente.' });
  const { plain, stored } = totp.generateRecoveryCodes(10);
  db.prepare("UPDATE admins SET totp_enabled = 1, totp_recovery_codes = ?, totp_enrolled_at = datetime('now') WHERE id = ?").run(stored, a.id);
  logActivity(a.name || a.email, 'ativou a verificação em duas etapas', null);
  res.json({ ok: true, recovery_codes: plain });
});

// POST /api/auth/2fa/disable — desliga (exige senha atual + código válido).
router.post('/2fa/disable', requireAuth, (req, res) => {
  const { password, code } = req.body || {};
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!a || !a.totp_enabled) return res.status(400).json({ error: 'A verificação em duas etapas não está ativa.' });
  if (!password || !bcrypt.compareSync(String(password), a.password_hash)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  const secret = decrypt(a.totp_secret);
  const okTotp = totp.verifyToken(secret, code);
  const okRec = !okTotp && totp.consumeRecoveryCode(a.totp_recovery_codes, code).ok;
  if (!okTotp && !okRec) return res.status(400).json({ error: 'Código incorreto.' });
  db.prepare("UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_recovery_codes = NULL, totp_enrolled_at = NULL WHERE id = ?").run(a.id);
  logActivity(a.name || a.email, 'desativou a verificação em duas etapas', null);
  res.json({ ok: true });
});

// POST /api/auth/2fa/verify — 2º passo do login. SEM requireAuth: o tenant vem
// do próprio mfa_token (claim tenant_slug), então abrimos o banco diretamente.
router.post('/2fa/verify', (req, res) => {
  const ip = clientIp(req) || 'desconhecido';
  if (mfaBlocked(ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  const { mfa_token, code } = req.body || {};
  let payload;
  try { payload = jwt.verify(String(mfa_token || ''), SECRET); }
  catch { return res.status(401).json({ error: 'Verificação expirada. Entre novamente.' }); }
  if (!payload.mfa_pending || !payload.tenant_slug) return res.status(401).json({ error: 'Token inválido. Entre novamente.' });

  const slug = payload.tenant_slug;
  const tenantDb = openTenantDb(slug);
  const admin = tenantDb.prepare('SELECT * FROM admins WHERE id = ?').get(payload.id);
  if (!admin || admin.deleted_at || admin.status !== 'ativo' || !admin.totp_enabled) {
    return res.status(401).json({ error: 'Não autorizado. Entre novamente.' });
  }
  const secret = decrypt(admin.totp_secret);
  const okTotp = totp.verifyToken(secret, code);
  let okRec = false;
  if (!okTotp) {
    const r = totp.consumeRecoveryCode(admin.totp_recovery_codes, code);
    if (r.ok) { okRec = true; tenantDb.prepare('UPDATE admins SET totp_recovery_codes = ? WHERE id = ?').run(r.stored, admin.id); }
  }
  if (!okTotp && !okRec) { mfaFail(ip); return res.status(401).json({ error: 'Código incorreto.' }); }

  mfaReset(ip);
  tenantDb.prepare("UPDATE admins SET last_login = datetime('now') WHERE id = ?").run(admin.id);
  runWithDb(slug, () => logActivity(admin.name || admin.email, 'fez login (com verificação em duas etapas)', null));
  pruneExpiredSessions();
  res.json({
    token: sign(admin, slug),
    refresh_token: createRefreshToken(slug, admin.id, req.headers['user-agent'], ip),
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
    recovery_used: okRec,
  });
});

module.exports = router;
