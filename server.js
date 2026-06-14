require('dotenv').config();
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos (frontend + imagens enviadas)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// ---- API ----
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/users', require('./src/routes/users.routes'));
app.use('/api/dashboard', require('./src/routes/dashboard.routes'));
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
