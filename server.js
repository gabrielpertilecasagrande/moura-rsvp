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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos (frontend + imagens enviadas)
// Serve uploads do volume persistente (se DATA_DIR definido) ou da pasta local.
const UPLOADS_PATH = process.env.DATA_DIR
  ? path.join(path.resolve(process.env.DATA_DIR), 'uploads')
  : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'img', 'favicon.ico')));

// ---- API ----
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/users', require('./src/routes/users.routes'));
app.use('/api/dashboard', require('./src/routes/dashboard.routes'));
app.use('/api/activity', require('./src/routes/activity.routes'));
app.use('/api/search', require('./src/routes/search.routes'));
app.use('/api/events', require('./src/routes/events.routes'));
app.use('/api/events/:id/participants', require('./src/routes/participants.routes'));
app.use('/api/public', require('./src/routes/public.routes'));

// ---- Páginas ----
const page = (file) => (_req, res) => res.sendFile(path.join(__dirname, 'public', file));

app.get('/', (_req, res) => res.redirect('/admin/login.html'));
app.get('/admin', (_req, res) => res.redirect('/admin/login.html'));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Link público de cada evento: /rsvp/:slug  (o slug é lido pelo JS da página)
app.get('/rsvp/:slug', page('rsvp/index.html'));

app.listen(PORT, () => {
  console.log(`\n  Moura RSVP rodando em ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`  Área administrativa: /admin/login.html\n`);
});
