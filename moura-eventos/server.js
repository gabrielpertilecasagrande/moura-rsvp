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
app.use('/api/suppliers', require('./src/routes/suppliers.routes'));
app.use('/api/events',   require('./src/routes/events.routes'));
app.use('/api/events/:id/contracts', require('./src/routes/contracts.routes'));
app.use('/api/events/:id/checklist', require('./src/routes/checklist.routes'));
app.use('/api/events/:id/files',     require('./src/routes/files.routes'));
app.use('/api/events/:id/diary',     require('./src/routes/diary.routes'));

// Páginas admin
const adminDir = path.join(__dirname, 'public', 'admin');
app.get('/admin/login.html',         (_req, res) => res.sendFile(path.join(adminDir, 'login.html')));
app.get('/admin/register.html',      (_req, res) => res.sendFile(path.join(adminDir, 'register.html')));
app.get('/admin/dashboard.html',     (_req, res) => res.sendFile(path.join(adminDir, 'dashboard.html')));
app.get('/admin/events.html',        (_req, res) => res.sendFile(path.join(adminDir, 'events.html')));
app.get('/admin/event-form.html',    (_req, res) => res.sendFile(path.join(adminDir, 'event-form.html')));
app.get('/admin/event-detail.html',  (_req, res) => res.sendFile(path.join(adminDir, 'event-detail.html')));
app.get('/admin/suppliers.html',     (_req, res) => res.sendFile(path.join(adminDir, 'suppliers.html')));
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

app.listen(PORT, () => console.log(`Moura Eventos rodando em http://localhost:${PORT}`));
