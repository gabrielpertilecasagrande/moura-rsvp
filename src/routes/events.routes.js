const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uniqueSlug, slugify } = require('../utils/slug');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(requireAuth); // todas as rotas deste arquivo exigem login

// ---- Upload de imagens (capa + logo do cliente) ----
// Uploads: se DATA_DIR estiver definido (volume Railway), salva lá dentro.
// Isso garante que capas e logos sobrevivem a redeploys, igual ao banco.
const DATA_DIR_UP = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..');
const UPLOAD_DIR = path.join(DATA_DIR_UP, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.img';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const ACCEPTED = /image\/(png|jpe?g|webp|gif|svg\+xml)/;
const uploadFields = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    cb(ACCEPTED.test(file.mimetype) ? null : new Error('FORMATO'), ACCEPTED.test(file.mimetype));
  },
}).fields([{ name: 'cover_image', maxCount: 1 }, { name: 'client_logo', maxCount: 1 }]);

// Wrapper que captura erros do multer e devolve JSON claro (em vez de página de erro).
function upload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'A imagem ultrapassa o limite de 10 MB. Reduza o tamanho e tente novamente.' });
    }
    if (err.message === 'FORMATO') {
      return res.status(400).json({ error: 'Formato não aceito. Use JPG, PNG, WEBP ou SVG. (Fotos de iPhone em HEIC precisam ser convertidas para JPG.)' });
    }
    return res.status(400).json({ error: 'Não foi possível enviar a imagem. Tente outro arquivo.' });
  });
}

// Remove um arquivo de /uploads do disco (silencioso se não existir).
function removeUpload(publicPath) {
  if (!publicPath) return;
  try {
    const abs = path.join(UPLOAD_DIR, path.basename(publicPath));
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* ignora */ }
}

const DEFAULT_FORM_CONFIG = {
  company: { enabled: false, required: false, label: 'Empresa' },
  role: { enabled: false, required: false, label: 'Cargo' },
  email: { enabled: false, required: false, label: 'E-mail' },
  phone: { enabled: false, required: false, label: 'Telefone/WhatsApp' },
};

function parseFormConfig(raw) {
  let parsed = {};
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch { parsed = {}; }
  const out = {};
  for (const k of Object.keys(DEFAULT_FORM_CONFIG)) {
    out[k] = { ...DEFAULT_FORM_CONFIG[k], ...(parsed[k] || {}) };
    if (!out[k].label) out[k].label = DEFAULT_FORM_CONFIG[k].label;
  }
  return out;
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

  // Slug: usa o personalizado (se enviado) ou deriva do nome.
  const slug = uniqueSlug(db, b.slug && b.slug.trim() ? b.slug : b.name);
  const cover = req.files?.cover_image?.[0]?.filename ? `/uploads/${req.files.cover_image[0].filename}` : null;
  const logo = req.files?.client_logo?.[0]?.filename ? `/uploads/${req.files.client_logo[0].filename}` : null;
  const formConfig = JSON.stringify(parseFormConfig(b.form_config));

  const info = db.prepare(`
    INSERT INTO events (slug, name, description, event_date, event_time, location,
      cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
      expected_guests, whatsapp, whatsapp_enabled, force_open, form_config)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    slug, b.name, b.description || null, b.event_date || null, b.event_time || null,
    b.location || null, cover, logo, b.rsvp_deadline || null, b.status || 'ativo',
    b.confirm_message || 'Olá, {nome}. Sua presença no evento foi confirmada com sucesso.',
    b.decline_message || 'Olá, {nome}. Registramos sua impossibilidade de participação no evento. Agradecemos seu retorno.',
    parseInt(b.expected_guests, 10) || 0, b.whatsapp || null,
    (b.whatsapp_enabled === '0' || b.whatsapp_enabled === 'false' || b.whatsapp_enabled === false) ? 0 : 1,
    0, formConfig
  );
  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  created.public_url = publicUrl(req, created.slug);
  logActivity(req.admin.name || req.admin.email, 'criou evento', created.name);
  res.status(201).json(created);
});

// PUT /api/events/:id  — atualiza
router.put('/:id', upload, (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const b = req.body;

  // Slug editável: se enviado e diferente, valida unicidade.
  let slug = e.slug;
  if (b.slug != null && b.slug.trim() && slugify(b.slug) !== e.slug) {
    slug = uniqueSlug(db, b.slug, e.id);
  }

  // Capa/logo: novo arquivo substitui; flag remove_* apaga; senão mantém.
  let cover = e.cover_image;
  if (req.files?.cover_image?.[0]?.filename) {
    removeUpload(e.cover_image);
    cover = `/uploads/${req.files.cover_image[0].filename}`;
  } else if (b.remove_cover === '1' || b.remove_cover === 'true') {
    removeUpload(e.cover_image);
    cover = null;
  }
  let logo = e.client_logo;
  if (req.files?.client_logo?.[0]?.filename) {
    removeUpload(e.client_logo);
    logo = `/uploads/${req.files.client_logo[0].filename}`;
  } else if (b.remove_logo === '1' || b.remove_logo === 'true') {
    removeUpload(e.client_logo);
    logo = null;
  }

  db.prepare(`
    UPDATE events SET
      slug=?, name=?, description=?, event_date=?, event_time=?,
      location=?, cover_image=?, client_logo=?,
      rsvp_deadline=?, status=?, confirm_message=?,
      decline_message=?, expected_guests=?, whatsapp=?, whatsapp_enabled=?,
      form_config=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    slug,
    b.name ?? e.name,
    b.description ?? e.description,
    b.event_date ?? e.event_date,
    b.event_time ?? e.event_time,
    b.location ?? e.location,
    cover, logo,
    b.rsvp_deadline ?? e.rsvp_deadline,
    b.status ?? e.status,
    b.confirm_message ?? e.confirm_message,
    b.decline_message ?? e.decline_message,
    b.expected_guests != null ? (parseInt(b.expected_guests, 10) || 0) : e.expected_guests,
    b.whatsapp != null ? (b.whatsapp || null) : e.whatsapp,
    b.whatsapp_enabled != null ? ((b.whatsapp_enabled === '0' || b.whatsapp_enabled === 'false' || b.whatsapp_enabled === false) ? 0 : 1) : e.whatsapp_enabled,
    b.form_config ? JSON.stringify(parseFormConfig(b.form_config)) : e.form_config,
    e.id
  );
  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(e.id);
  updated.form_config = parseFormConfig(updated.form_config);
  updated.public_url = publicUrl(req, updated.slug);
  logActivity(req.admin.name || req.admin.email, 'editou evento', updated.name);
  res.json(updated);
});

// PATCH /api/events/:id/reopen  — reabre/encerra confirmações sem mexer nas datas
router.patch('/:id/reopen', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const open = req.body?.open ? 1 : 0;
  db.prepare("UPDATE events SET force_open=?, updated_at=datetime('now') WHERE id=?").run(open, e.id);
  res.json({ ok: true, force_open: open });
});

// POST /api/events/:id/duplicate — duplica um evento (sem participantes)
router.post('/:id/duplicate', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const slug = uniqueSlug(db, `${e.name} copia`);
  const info = db.prepare(`
    INSERT INTO events (slug, name, description, event_date, event_time, location,
      cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
      expected_guests, whatsapp, whatsapp_enabled, force_open, form_config)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    slug, `${e.name} (cópia)`, e.description, e.event_date, e.event_time, e.location,
    e.cover_image, e.client_logo, e.rsvp_deadline, 'ativo', e.confirm_message, e.decline_message,
    e.expected_guests, e.whatsapp, e.whatsapp_enabled, 0, e.form_config
  );
  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  created.public_url = publicUrl(req, created.slug);
  logActivity(req.admin.name || req.admin.email, 'duplicou evento', `${e.name} → ${created.name}`);
  res.status(201).json(created);
});

// DELETE /api/events/:id
router.delete('/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  removeUpload(e.cover_image);
  removeUpload(e.client_logo);
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  logActivity(req.admin.name || req.admin.email, 'excluiu evento', e.name);
  res.json({ ok: true });
});

// GET /api/events/:id/qrcode?format=png|jpg|svg|pdf  — QR Code preto e branco
router.get('/:id/qrcode', async (req, res) => {
  const e = db.prepare('SELECT slug, name FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const url = publicUrl(req, e.slug);
  const fmt = (req.query.format || 'png').toLowerCase();
  const safe = (e.slug || 'evento').replace(/[^a-z0-9-]/gi, '');
  const opts = { margin: 2, color: { dark: '#000000', light: '#FFFFFF' } };

  try {
    if (fmt === 'svg') {
      const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="qrcode-${safe}.svg"`);
      return res.send(svg);
    }
    if (fmt === 'jpg' || fmt === 'jpeg') {
      const pngBuf = await QRCode.toBuffer(url, { ...opts, type: 'png', width: 800 });
      const png = PNG.sync.read(pngBuf);
      const jpg = jpeg.encode({ data: png.data, width: png.width, height: png.height }, 92);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', `attachment; filename="qrcode-${safe}.jpg"`);
      return res.send(jpg.data);
    }
    if (fmt === 'pdf') {
      const png = await QRCode.toBuffer(url, { ...opts, type: 'png', width: 800 });
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="qrcode-${safe}.pdf"`);
      doc.pipe(res);
      doc.fontSize(20).fillColor('#2C427E').text(e.name || 'Evento', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor('#28282A').text('Aponte a câmera para confirmar presença', { align: 'center' });
      doc.moveDown(1.5);
      const size = 320;
      doc.image(png, (doc.page.width - size) / 2, doc.y, { width: size, height: size });
      doc.moveDown(0.5);
      doc.y += size + 20;
      doc.fontSize(10).fillColor('#5b6472').text(url, { align: 'center', link: url });
      doc.end();
      return;
    }
    // PNG (padrão)
    const png = await QRCode.toBuffer(url, { ...opts, type: 'png', width: 800 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qrcode-${safe}.png"`);
    return res.send(png);
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível gerar o QR Code.' });
  }
});

module.exports = router;
