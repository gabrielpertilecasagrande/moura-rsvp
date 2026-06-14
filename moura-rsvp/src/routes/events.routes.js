const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uniqueSlug } = require('../utils/slug');

const router = express.Router();
router.use(requireAuth); // todas as rotas deste arquivo exigem login

// ---- Upload de imagens (capa + logo do cliente) ----
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|svg\+xml)/.test(file.mimetype);
    cb(ok ? null : new Error('Envie uma imagem (PNG, JPG, WEBP ou SVG).'), ok);
  },
}).fields([{ name: 'cover_image', maxCount: 1 }, { name: 'client_logo', maxCount: 1 }]);

const DEFAULT_FORM_CONFIG = {
  company: { enabled: false, required: false, label: 'Empresa' },
  role: { enabled: false, required: false, label: 'Cargo' },
  email: { enabled: false, required: false, label: 'E-mail' },
  phone: { enabled: false, required: false, label: 'Telefone/WhatsApp' },
};

function parseFormConfig(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_FORM_CONFIG, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_FORM_CONFIG };
  }
}

function publicUrl(req, slug) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/rsvp/${slug}`;
}

// GET /api/events  — lista todos
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS total_responses,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.response='confirmado') AS confirmed,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.response='recusado') AS declined
    FROM events e ORDER BY e.created_at DESC
  `).all();
  res.json(rows.map((r) => ({ ...r, public_url: publicUrl(req, r.slug) })));
});

// GET /api/events/:id  — detalhe
router.get('/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  e.form_config = parseFormConfig(e.form_config);
  e.public_url = publicUrl(req, e.slug);
  res.json(e);
});

// POST /api/events  — cria
router.post('/', upload, (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });

  const slug = uniqueSlug(db, b.name);
  const cover = req.files?.cover_image?.[0]?.filename ? `/uploads/${req.files.cover_image[0].filename}` : null;
  const logo = req.files?.client_logo?.[0]?.filename ? `/uploads/${req.files.client_logo[0].filename}` : null;
  const formConfig = JSON.stringify(parseFormConfig(b.form_config));

  const info = db.prepare(`
    INSERT INTO events (slug, name, description, event_date, event_time, location,
      cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
      expected_guests, whatsapp, form_config)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    slug,
    b.name,
    b.description || null,
    b.event_date || null,
    b.event_time || null,
    b.location || null,
    cover,
    logo,
    b.rsvp_deadline || null,
    b.status || 'ativo',
    b.confirm_message || 'Presença confirmada. Obrigado!',
    b.decline_message || 'Resposta registrada. Agradecemos o retorno.',
    parseInt(b.expected_guests, 10) || 0,
    b.whatsapp || null,
    formConfig
  );
  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  created.public_url = publicUrl(req, created.slug);
  res.status(201).json(created);
});

// PUT /api/events/:id  — atualiza
router.put('/:id', upload, (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const b = req.body;

  const cover = req.files?.cover_image?.[0]?.filename ? `/uploads/${req.files.cover_image[0].filename}` : e.cover_image;
  const logo = req.files?.client_logo?.[0]?.filename ? `/uploads/${req.files.client_logo[0].filename}` : e.client_logo;

  db.prepare(`
    UPDATE events SET
      name=?, description=?, event_date=?, event_time=?,
      location=?, cover_image=?, client_logo=?,
      rsvp_deadline=?, status=?, confirm_message=?,
      decline_message=?, expected_guests=?, whatsapp=?,
      form_config=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.name ?? e.name,
    b.description ?? e.description,
    b.event_date ?? e.event_date,
    b.event_time ?? e.event_time,
    b.location ?? e.location,
    cover,
    logo,
    b.rsvp_deadline ?? e.rsvp_deadline,
    b.status ?? e.status,
    b.confirm_message ?? e.confirm_message,
    b.decline_message ?? e.decline_message,
    b.expected_guests != null ? (parseInt(b.expected_guests, 10) || 0) : e.expected_guests,
    b.whatsapp != null ? (b.whatsapp || null) : e.whatsapp,
    b.form_config ? JSON.stringify(parseFormConfig(b.form_config)) : e.form_config,
    e.id
  );
  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(e.id);
  updated.form_config = parseFormConfig(updated.form_config);
  updated.public_url = publicUrl(req, updated.slug);
  res.json(updated);
});

// DELETE /api/events/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Evento não encontrado.' });
  res.json({ ok: true });
});

// GET /api/events/:id/qrcode  — PNG do QR Code da URL pública
router.get('/:id/qrcode', async (req, res) => {
  const e = db.prepare('SELECT slug FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const url = publicUrl(req, e.slug);
  const png = await QRCode.toBuffer(url, { width: 600, margin: 2, color: { dark: '#2C427E', light: '#FFFFFF' } });
  res.type('png').send(png);
});

module.exports = router;
