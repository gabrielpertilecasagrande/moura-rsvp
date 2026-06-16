require('dotenv').config();
const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// Segurança básica
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Arquivos estáticos
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// Rate limiting
const { rateLimit } = require('./src/middleware/rateLimit');
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' });

// Rotas da API
app.use('/api/auth',     loginLimiter, require('./src/routes/auth.routes'));
app.use('/api/users',    require('./src/routes/users.routes'));
app.use('/api/dashboard', require('./src/routes/dashboard.routes'));
app.use('/api/activity', require('./src/routes/activity.routes'));
app.use('/api/search',   require('./src/routes/search.routes'));
app.use('/api/calendar', require('./src/routes/calendar.routes'));
app.use('/api/clients',  require('./src/routes/clients.routes'));
app.use('/api/locations', require('./src/routes/locations.routes'));
app.use('/api/command-center', require('./src/routes/command.routes'));
app.use('/api/team', require('./src/routes/team.routes'));
app.use('/api/suppliers', require('./src/routes/suppliers.routes'));
app.use('/api/events',   require('./src/routes/events.routes'));
app.use('/api/events/:id/contracts', require('./src/routes/contracts.routes'));
app.use('/api/events/:id/checklist', require('./src/routes/checklist.routes'));
app.use('/api/events/:id/files',     require('./src/routes/files.routes'));
app.use('/api/events/:id/diary',      require('./src/routes/diary.routes'));
app.use('/api/events/:id/approvals',  require('./src/routes/approvals.routes'));
app.use('/api/events/:id/risks',      require('./src/routes/risks.routes'));
app.use('/api/events/:id/decisions',  require('./src/routes/decisions.routes'));
app.use('/api/events/:id/crises',     require('./src/routes/crises.routes'));

// Páginas admin
const adminDir = path.join(__dirname, 'public', 'admin');
app.get('/admin/login.html',         (_req, res) => res.sendFile(path.join(adminDir, 'login.html')));
app.get('/admin/register.html',      (_req, res) => res.sendFile(path.join(adminDir, 'register.html')));
app.get('/admin/dashboard.html',     (_req, res) => res.sendFile(path.join(adminDir, 'dashboard.html')));
app.get('/admin/events.html',        (_req, res) => res.sendFile(path.join(adminDir, 'events.html')));
app.get('/admin/event-form.html',    (_req, res) => res.sendFile(path.join(adminDir, 'event-form.html')));
app.get('/admin/event-detail.html',  (_req, res) => res.sendFile(path.join(adminDir, 'event-detail.html')));
app.get('/admin/suppliers.html',     (_req, res) => res.sendFile(path.join(adminDir, 'suppliers.html')));
app.get('/admin/calendar.html',      (_req, res) => res.sendFile(path.join(adminDir, 'calendar.html')));
app.get('/admin/clients.html',       (_req, res) => res.sendFile(path.join(adminDir, 'clients.html')));
app.get('/admin/command.html',        (_req, res) => res.sendFile(path.join(adminDir, 'command.html')));
app.get('/admin/team.html',           (_req, res) => res.sendFile(path.join(adminDir, 'team.html')));
app.get('/admin/supplier-form.html', (_req, res) => res.sendFile(path.join(adminDir, 'supplier-form.html')));
app.get('/admin/users.html',         (_req, res) => res.sendFile(path.join(adminDir, 'users.html')));
app.get('/admin/activity.html',      (_req, res) => res.sendFile(path.join(adminDir, 'activity.html')));
app.get('/admin/account.html',       (_req, res) => res.sendFile(path.join(adminDir, 'account.html')));
app.get('/', (_req, res) => res.redirect('/admin/dashboard.html'));

// Erro global
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Arquivo muito grande. Limite: 20 MB.' });
  }
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ── Bootstrap na inicialização ────────────────────────────────────────────────
// 1) Garante o admin (login funciona após todo deploy, sem seed manual).
// 2) Loga o caminho do banco e a contagem de eventos para diagnosticar se o
//    volume persistente está realmente montado (se "eventos" zerar a cada deploy,
//    o volume NÃO está ativo no serviço).
const db = require('./src/db');
const { ensureAdmin } = require('./src/utils/ensureAdmin');
try {
  const r = ensureAdmin();
  console.log(`[seed] admin ${r.created ? 'CRIADO' : 'já existe'}: ${r.email}`);
} catch (e) {
  console.error('[seed] falha ao garantir admin:', e.message);
}
try {
  const n = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const usandoVolume = !!process.env.DATA_DIR;
  console.log(`[db] caminho=${db.dbPath} | DATA_DIR=${process.env.DATA_DIR || '(não definido)'} | eventos=${n} | volume_esperado=${usandoVolume}`);
} catch (e) {
  console.error('[db] falha no diagnóstico:', e.message);
}

app.listen(PORT, () => console.log(`Moura One rodando em http://localhost:${PORT}`));
