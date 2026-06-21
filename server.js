require('dotenv').config();
const path = require('path');
const fs   = require('fs');

// ── Parâmetros do tenant padrão (organização inicial / Moura) ─────────────────
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'moura';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Organização';
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

// ── Auto-migração: detecta banco legado e migra para multi-tenant ─────────────
// Se o banco antigo (moura-rsvp.db) existir mas o novo (tenants/<slug>/rsvp.db)
// ainda não, executa a migração automaticamente para evitar perda de dados num
// deploy sem rodar o script manual antes.
const oldDbPath = path.join(DATA_DIR, 'moura-rsvp.db');
const newDbPath = path.join(DATA_DIR, 'tenants', DEFAULT_TENANT_SLUG, 'rsvp.db');
if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
  console.log('[startup] banco legado detectado — executando migração para multi-tenant...');
  try {
    require('./scripts/migrate-to-multitenant')({ tenantSlug: DEFAULT_TENANT_SLUG, tenantName: DEFAULT_TENANT_NAME });
    console.log('[startup] migração concluída com sucesso');
  } catch (e) {
    console.error('[startup] ERRO na migração automática:', e.message);
    console.error('          Execute manualmente: node scripts/migrate-to-multitenant.js');
    process.exit(1);
  }
}

// ── Seed: garante que a organização e o admin inicial existem ─────────────────
// Idempotente: roda a cada deploy sem apagar dados existentes.
try {
  const bcrypt     = require('bcryptjs');
  const router     = require('./src/router');
  const { openTenantDb } = require('./src/db');

  // Cria a organização no router.db se ainda não existir.
  if (!router.organizationExists(DEFAULT_TENANT_SLUG)) {
    router.createOrganization(DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME);
    console.log(`[seed] organização criada: ${DEFAULT_TENANT_SLUG}`);
  }

  const tenantDb  = openTenantDb(DEFAULT_TENANT_SLUG);
  const seedEmail = (process.env.ADMIN_EMAIL    || 'admin@moura.com.br').toLowerCase();
  const seedName  =  process.env.ADMIN_NAME     || 'Administrador';
  const seedPass  =  process.env.ADMIN_PASSWORD || 'moura2026';

  const exists = tenantDb.prepare('SELECT id FROM admins WHERE email = ?').get(seedEmail);
  if (exists) {
    tenantDb.prepare("UPDATE admins SET role='admin', status='ativo' WHERE id=?").run(exists.id);
    console.log(`[seed] admin já existe: ${seedEmail}`);
  } else {
    const hash = bcrypt.hashSync(seedPass, 10);
    tenantDb.prepare(
      "INSERT INTO admins (name, email, password_hash, role, status) VALUES (?,?,?,'admin','ativo')"
    ).run(seedName, seedEmail, hash);
    console.log(`[seed] admin criado: ${seedEmail}`);
  }

  // Garante que o e-mail do admin seed está no índice global.
  if (!router.findTenantByEmail(seedEmail)) {
    router.registerAdminEmail(seedEmail, DEFAULT_TENANT_SLUG);
  }
} catch (e) {
  console.error('[seed] erro ao garantir admin:', e.message);
}

// ── Express ───────────────────────────────────────────────────────────────────
const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Content-Security-Policy: bloqueia carregar scripts de outros domínios (mitiga
// XSS). Mantém 'unsafe-inline' porque as telas usam estilos/handlers inline.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Uploads: diretório global (todos os tenants compartilham, nomes são aleatórios).
const UPLOADS_PATH = path.join(DATA_DIR, 'uploads');
app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'img', 'favicon.ico')));

// ── Limitadores de taxa ────────────────────────────────────────────────────────
const { rateLimit } = require('./src/middleware/rateLimit');
const authLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60,  message: 'Muitas respostas em sequência. Aguarde um instante e tente novamente.' });

// ── API ────────────────────────────────────────────────────────────────────────
app.use('/api/auth',                         authLimiter,   require('./src/routes/auth.routes'));
app.use('/api/users',                                       require('./src/routes/users.routes'));
app.use('/api/dashboard',                                   require('./src/routes/dashboard.routes'));
app.use('/api/activity',                                    require('./src/routes/activity.routes'));
app.use('/api/search',                                      require('./src/routes/search.routes'));
app.use('/api/backup',                                      require('./src/routes/backup.routes'));
app.use('/api/events',                                      require('./src/routes/events.routes'));
app.use('/api/events/:id/participants',                     require('./src/routes/participants.routes'));
app.use('/api/public',                       publicLimiter, require('./src/routes/public.routes'));
app.use('/api/platform',                                    require('./src/routes/platform.routes'));
app.use('/api/lgpd',                                        require('./src/routes/lgpd.routes'));

// ── Páginas ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.redirect('/admin/login.html'));
app.get('/admin', (_req, res) => res.redirect('/admin/login.html'));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Link público do evento: /rsvp/:slug  (o slug é lido pelo JS da página via API pública)
app.get('/rsvp/:slug', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'rsvp', 'index.html')));

// Página pública de Privacidade/LGPD (rodapé).
app.get(['/legal.html', '/privacidade', '/termos', '/cookies', '/lgpd'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'legal.html')));

// Painel de operação da plataforma (provisionamento de organizadores).
// Caminho configurável via PLATFORM_PATH para não expor URL previsível em produção.
const PLATFORM_PATH = (process.env.PLATFORM_PATH || '/platform').replace(/\/+$/, '');
app.get(PLATFORM_PATH, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'platform', 'index.html')));

// ── Tratador de erros ──────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err && (err.status || err.statusCode);
  if (status && status < 500) {
    if (!res.headersSent) res.status(status).json({ error: 'Requisição inválida.' });
    return;
  }
  console.error('[erro]', err && err.message ? err.message : err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Ocorreu um erro inesperado. Tente novamente.' });
});

process.on('uncaughtException',  (e) => console.error('[uncaughtException]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

app.listen(PORT, () => {
  console.log(`\n  Moura RSVP rodando em ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`  Área administrativa: /admin/login.html\n`);
});
