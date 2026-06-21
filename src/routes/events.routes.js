'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const jwt          = require('jsonwebtoken');
const multer       = require('multer');
const QRCode       = require('qrcode');
const PDFDocument  = require('pdfkit');
const { PNG }      = require('pngjs');
const jpeg         = require('jpeg-js');
const db           = require('../db');
const { requireAuth, SECRET }    = require('../middleware/auth');
const { runWithDb }              = require('../db');
const { uniqueSlug, slugify }    = require('../utils/slug');
const { logActivity }            = require('../utils/activity');
const { parseFormConfig }        = require('../utils/formConfig');
const {
  authorizedEventIds, permsFor, grantFullAccess, normalizeRole, requireRole, requirePerm,
} = require('../utils/permissions');
const {
  registerEventSlug, unregisterEventSlug, organizationExists,
} = require('../router');

const router = express.Router();

// Slug do tenant padrão usado para service calls sem contexto de autenticação.
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_SLUG || 'moura';

// ── GET /api/events/:id/metrics ───────────────────────────────────────────────
// Aceita dois modos:
//   1) Service token (JWT com claim target:'rsvp') — chamada máquina-a-máquina.
//      Usa X-Tenant-Slug header ou DEFAULT_TENANT para identificar o banco.
//   2) Sessão normal de usuário — requireAuth + requirePerm.
function metricsAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload && payload.target === 'rsvp') {
        req.serviceCall = true;
        const tenantSlug = String(req.headers['x-tenant-slug'] || DEFAULT_TENANT).toLowerCase().trim();
        // Só aceita um tenant que já existe (evita criar bancos arbitrários e
        // travessia de caminho via header).
        if (!organizationExists(tenantSlug)) {
          return res.status(404).json({ error: 'Organização não encontrada.' });
        }
        return runWithDb(tenantSlug, () => next());
      }
    } catch { /* signature inválida → tenta sessão normal */ }
  }
  return requireAuth(req, res, () => requirePerm('can_view')(req, res, next));
}

router.get('/:id/metrics', metricsAuth, (req, res) => {
  const e = db.prepare('SELECT id, name, expected_guests FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_responses,
      SUM(CASE WHEN response = 'confirmado' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN response = 'recusado'   THEN 1 ELSE 0 END) AS declined
    FROM participants WHERE event_id = ?
  `).get(e.id);
  const confirmed = Number(row.confirmed || 0);
  const declined  = Number(row.declined  || 0);
  const total     = Number(row.total_responses || 0);
  const expected  = Number(e.expected_guests || 0);
  const pending   = expected > 0 ? Math.max(0, expected - confirmed - declined) : 0;
  res.json({ event_id: e.id, confirmed, declined, pending, total_responses: total, expected_guests: expected });
});

router.use(requireAuth); // todas as rotas abaixo exigem login

// ── Uploads de imagens ────────────────────────────────────────────────────────
// Armazenados em DATA_DIR/uploads/ (diretório global, independente do tenant).
// LGPD: nomes de arquivo são aleatórios (não identificam o tenant).
// Isolamento por tenant em uploads pode ser adicionado em fase futura.
const DATA_DIR_UP = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..');
const UPLOAD_DIR  = path.join(DATA_DIR_UP, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file,  cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.img';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
// SVG fora de propósito: pode conter script e ser servido inline a partir de
// /uploads (mesma origem) — risco de XSS. Aceitamos só imagens rasterizadas.
const ACCEPTED = /image\/(png|jpe?g|webp|gif)/;
const uploadFields = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(ACCEPTED.test(file.mimetype) ? null : new Error('FORMATO'), ACCEPTED.test(file.mimetype)),
}).fields([{ name: 'cover_image', maxCount: 1 }, { name: 'client_logo', maxCount: 1 }]);

function upload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'A imagem ultrapassa o limite de 10 MB.' });
    if (err.message === 'FORMATO') return res.status(400).json({ error: 'Formato não aceito. Use JPG, PNG, WEBP ou GIF.' });
    return res.status(400).json({ error: 'Não foi possível enviar a imagem.' });
  });
}

function removeUpload(publicPath) {
  if (!publicPath) return;
  try {
    const abs = path.join(UPLOAD_DIR, path.basename(publicPath));
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* ignora */ }
}

function publicUrl(req, slug) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/rsvp/${slug}`;
}

// GET /api/events — lista os eventos que o usuário pode visualizar
router.get('/', (req, res) => {
  const ids = authorizedEventIds(req.admin);
  let where = '', params = [];
  if (ids !== null) {
    if (!ids.length) return res.json([]);
    where  = `WHERE e.id IN (${ids.map(() => '?').join(',')})`;
    params = ids;
  }
  const rows = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS total_responses,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.response='confirmado') AS confirmed,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.response='recusado') AS declined
    FROM events e ${where} ORDER BY e.created_at DESC
  `).all(...params);
  res.json(rows.map((r) => ({ ...r, public_url: publicUrl(req, r.slug), _perms: permsFor(req.admin, r.id) })));
});

// GET /api/events/:id
router.get('/:id', requirePerm('can_view'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  e.form_config = parseFormConfig(e.form_config);
  e.public_url  = publicUrl(req, e.slug);
  e._perms      = permsFor(req.admin, e.id);
  res.json(e);
});

// POST /api/events — cria evento
router.post('/', requireRole('admin', 'gestor'), upload, (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });

  const slug       = uniqueSlug(db, b.slug && b.slug.trim() ? b.slug : b.name);
  const cover      = req.files?.cover_image?.[0]?.filename ? `/uploads/${req.files.cover_image[0].filename}` : null;
  const logo       = req.files?.client_logo?.[0]?.filename ? `/uploads/${req.files.client_logo[0].filename}` : null;
  const formConfig = JSON.stringify(parseFormConfig(b.form_config));

  const info = db.prepare(`
    INSERT INTO events (slug, name, description, event_date, event_time, location, city, address,
      cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
      expected_guests, whatsapp, whatsapp_enabled, force_open, form_config)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    slug, b.name, b.description || null, b.event_date || null, b.event_time || null,
    b.location || null, b.city || null, b.address || null, cover, logo, b.rsvp_deadline || null,
    b.status || 'ativo',
    b.confirm_message || 'Olá, {nome}. Sua presença no evento foi confirmada com sucesso.',
    b.decline_message || 'Olá, {nome}. Registramos sua impossibilidade de participação no evento. Agradecemos seu retorno.',
    parseInt(b.expected_guests, 10) || 0, b.whatsapp || null,
    (b.whatsapp_enabled === '0' || b.whatsapp_enabled === 'false' || b.whatsapp_enabled === false) ? 0 : 1,
    0, formConfig
  );

  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  if (normalizeRole(req.admin.role) !== 'admin') grantFullAccess(req.admin.id, created.id);

  // Registra o slug no índice global para roteamento público.
  registerEventSlug(created.slug, req.tenantSlug);

  created.public_url = publicUrl(req, created.slug);
  logActivity(req.admin.name || req.admin.email, 'criou evento', created.name);
  res.status(201).json(created);
});

// PUT /api/events/:id
router.put('/:id', requirePerm('can_edit'), upload, (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const b = req.body;

  let slug = e.slug;
  if (b.slug != null && b.slug.trim() && slugify(b.slug) !== e.slug) {
    slug = uniqueSlug(db, b.slug, e.id);
  }

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
      location=?, city=?, address=?, cover_image=?, client_logo=?,
      rsvp_deadline=?, status=?, confirm_message=?,
      decline_message=?, expected_guests=?, whatsapp=?, whatsapp_enabled=?,
      form_config=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    slug, b.name ?? e.name, b.description ?? e.description,
    b.event_date ?? e.event_date, b.event_time ?? e.event_time,
    b.location ?? e.location, b.city ?? e.city, b.address ?? e.address,
    cover, logo, b.rsvp_deadline ?? e.rsvp_deadline, b.status ?? e.status,
    b.confirm_message ?? e.confirm_message, b.decline_message ?? e.decline_message,
    b.expected_guests != null ? (parseInt(b.expected_guests, 10) || 0) : e.expected_guests,
    b.whatsapp != null ? (b.whatsapp || null) : e.whatsapp,
    b.whatsapp_enabled != null ? ((b.whatsapp_enabled === '0' || b.whatsapp_enabled === 'false' || b.whatsapp_enabled === false) ? 0 : 1) : e.whatsapp_enabled,
    b.form_config ? JSON.stringify(parseFormConfig(b.form_config)) : e.form_config,
    e.id
  );

  // Atualiza o índice global se o slug mudou.
  if (slug !== e.slug) {
    unregisterEventSlug(e.slug);
    registerEventSlug(slug, req.tenantSlug);
  }

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(e.id);

  const FIELD_LABELS = {
    slug: 'link público', name: 'nome', description: 'descrição', event_date: 'data',
    event_time: 'horário', location: 'local', city: 'cidade', address: 'endereço',
    rsvp_deadline: 'prazo de confirmação', status: 'status', confirm_message: 'mensagem de confirmação',
    decline_message: 'mensagem de recusa', expected_guests: 'convidados esperados',
    whatsapp: 'WhatsApp', whatsapp_enabled: 'exibição do botão de WhatsApp',
    cover_image: 'imagem de capa', client_logo: 'logo do cliente',
  };
  const norm = (v) => (v == null ? '' : String(v));
  const changed = [];
  for (const k of Object.keys(FIELD_LABELS)) {
    if (norm(e[k]) !== norm(updated[k])) changed.push(FIELD_LABELS[k]);
  }
  if (norm(e.form_config) !== norm(updated.form_config)) changed.push('campos do formulário');
  const details = changed.length
    ? `${updated.name} — alterou: ${changed.join(', ')}`
    : `${updated.name} — sem alterações de conteúdo`;
  logActivity(req.admin.name || req.admin.email, 'editou evento', details);

  updated.form_config = parseFormConfig(updated.form_config);
  updated.public_url  = publicUrl(req, updated.slug);
  res.json(updated);
});

// PATCH /api/events/:id/reopen
router.patch('/:id/reopen', requirePerm('can_edit'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const open = req.body?.open ? 1 : 0;
  db.prepare("UPDATE events SET force_open=?, updated_at=datetime('now') WHERE id=?").run(open, e.id);
  res.json({ ok: true, force_open: open });
});

// POST /api/events/:id/duplicate
router.post('/:id/duplicate', requirePerm('can_duplicate'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const slug = uniqueSlug(db, `${e.name} copia`);
  const info = db.prepare(`
    INSERT INTO events (slug, name, description, event_date, event_time, location, city, address,
      cover_image, client_logo, rsvp_deadline, status, confirm_message, decline_message,
      expected_guests, whatsapp, whatsapp_enabled, force_open, form_config)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    slug, `${e.name} (cópia)`, e.description, e.event_date, e.event_time, e.location, e.city, e.address,
    e.cover_image, e.client_logo, e.rsvp_deadline, 'ativo', e.confirm_message, e.decline_message,
    e.expected_guests, e.whatsapp, e.whatsapp_enabled, 0, e.form_config
  );
  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  if (normalizeRole(req.admin.role) !== 'admin') grantFullAccess(req.admin.id, created.id);

  registerEventSlug(created.slug, req.tenantSlug);

  created.public_url = publicUrl(req, created.slug);
  logActivity(req.admin.name || req.admin.email, 'duplicou evento', `${e.name} → ${created.name}`);
  res.status(201).json(created);
});

// DELETE /api/events/:id
router.delete('/:id', requirePerm('can_delete'), (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  removeUpload(e.cover_image);
  removeUpload(e.client_logo);
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM event_access WHERE event_id = ?').run(req.params.id);

  unregisterEventSlug(e.slug);

  logActivity(req.admin.name || req.admin.email, 'excluiu evento', e.name);
  res.json({ ok: true });
});

// GET /api/events/:id/qrcode?format=png|jpg|svg|pdf
router.get('/:id/qrcode', requirePerm('can_view'), async (req, res) => {
  const e = db.prepare('SELECT slug, name FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
  const url  = publicUrl(req, e.slug);
  const fmt  = (req.query.format || 'png').toLowerCase();
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
      const png    = PNG.sync.read(pngBuf);
      const jpg    = jpeg.encode({ data: png.data, width: png.width, height: png.height }, 92);
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
      doc.y += size + 20;
      doc.fontSize(10).fillColor('#5b6472').text(url, { align: 'center', link: url });
      doc.end();
      return;
    }
    const png = await QRCode.toBuffer(url, { ...opts, type: 'png', width: 800 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qrcode-${safe}.png"`);
    return res.send(png);
  } catch {
    res.status(500).json({ error: 'Não foi possível gerar o QR Code.' });
  }
});

module.exports = router;
