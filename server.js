require('dotenv').config();
const path = require('path');
const express = require('express');

// ---- Auto-seed: garante que o admin inicial existe no banco ----
// Roda SEMPRE na inicialização, mas é idempotente:
// se o admin já existe, apenas confirma role=admin/status=ativo.
// Isso resolve o problema de disco temporário no Railway:
// mesmo que o banco seja resetado num redeploy, o admin é recriado.
try {
  const bcrypt = require('bcryptjs');
  const db = require('./src/db');
  const seedEmail = (process.env.ADMIN_EMAIL || 'admin@moura.com.br').toLowerCase();
  const seedName  = process.env.ADMIN_NAME  || 'Administrador';
  const seedPass  = process.env.ADMIN_PASSWORD || 'moura2026';
  const exists = db.prepare('SELECT id FROM admins WHERE email = ?').get(seedEmail);
  if (exists) {
    db.prepare("UPDATE admins SET role='admin', status='ativo' WHERE id=?").run(exists.id);
    console.log(`[seed] admin já existe: ${seedEmail}`);
  } else {
    const hash = bcrypt.hashSync(seedPass, 10);
    db.prepare("INSERT INTO admins (name, email, password_hash, role, status) VALUES (?,?,?,'admin','ativo')")
      .run(seedName, seedEmail, hash);
    console.log(`[seed] admin criado: ${seedEmail}`);
  }
} catch (e) {
  console.error('[seed] erro ao garantir admin:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Atrás do proxy do Railway: permite ler o IP real do visitante (X-Forwarded-For).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeçalhos de segurança (não quebram o app; reforçam a proteção do navegador).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Limita o tamanho do corpo das requisições (evita payloads gigantes).
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Arquivos estáticos (frontend + imagens enviadas)
// Serve uploads do volume persistente (se DATA_DIR definido) ou da pasta local.
const UPLOADS_PATH = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'uploads')
  : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'img', 'favicon.ico')));

// ---- Limitadores de taxa ----
const { rateLimit } = require('./src/middleware/rateLimit');
// Login/cadastro: protege contra tentativas de adivinhar senha (força bruta).
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
// Formulário público: generoso (vários convidados no mesmo wi-fi do evento),
// mas suficiente para barrar automação em massa.
const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: 'Muitas respostas em sequência. Aguarde um instante e tente novamente.' });

// ---- API ----
app.use('/api/auth', authLimiter, require('./src/routes/auth.routes'));
app.use('/api/users', require('./src/routes/users.routes'));
app.use('/api/dashboard', require('./src/routes/dashboard.routes'));
app.use('/api/activity', require('./src/routes/activity.routes'));
app.use('/api/search', require('./src/routes/search.routes'));
app.use('/api/backup', require('./src/routes/backup.routes'));
app.use('/api/events', require('./src/routes/events.routes'));
app.use('/api/events/:id/participants', require('./src/routes/participants.routes'));
app.use('/api/public', publicLimiter, require('./src/routes/public.routes'));

// ---- Páginas ----
const page = (file) => (_req, res) => res.sendFile(path.join(__dirname, 'public', file));

app.get('/', (_req, res) => res.redirect('/admin/login.html'));
app.get('/admin', (_req, res) => res.redirect('/admin/login.html'));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Link público de cada evento: /rsvp/:slug  (o slug é lido pelo JS da página)
app.get('/rsvp/:slug', page('rsvp/index.html'));

// Tratador global de erros: evita que uma falha derrube o servidor.
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

// Em caso de exceção não capturada, registra mas não encerra o processo.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

app.listen(PORT, () => {
  console.log(`\n  Moura RSVP rodando em ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`  Área administrativa: /admin/login.html\n`);
});
