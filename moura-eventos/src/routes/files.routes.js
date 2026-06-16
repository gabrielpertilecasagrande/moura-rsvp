const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');
const { uploadsDir, removeStoredFile } = require('../utils/uploads');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const FILE_CATEGORIES = ['Contratos', 'Orçamentos', 'Plantas', 'Artes', 'Cronogramas', 'Notas fiscais', 'Fotos', 'Documentos do cliente', 'Documentos de fornecedores', 'Outros'];

// GET /api/events/:id/files
router.get('/', requirePerm('can_view'), (req, res) => {
  const rows = db.prepare(
    'SELECT id, filename, mime_type, size, uploaded_by, category, created_at FROM event_files WHERE event_id = ? ORDER BY created_at DESC'
  ).all(Number(req.params.id));
  res.json(rows);
});

// POST /api/events/:id/files
router.post('/', requirePerm('can_files'), upload.single('file'), (req, res) => {
  const eventId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const ev = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!ev) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Evento não encontrado.' });
  }

  const category = FILE_CATEGORIES.includes(req.body?.category) ? req.body.category : 'Outros';

  const info = db.prepare(
    `INSERT INTO event_files (event_id, filename, stored_name, mime_type, size, uploaded_by, category)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    req.file.originalname,
    req.file.filename,
    req.file.mimetype,
    req.file.size,
    req.admin.name || req.admin.email,
    category
  );

  touchEvent(eventId);
  logActivity(req.admin.name || req.admin.email, 'enviou arquivo', req.file.originalname);
  res.status(201).json(
    db.prepare('SELECT id, filename, mime_type, size, uploaded_by, category, created_at FROM event_files WHERE id = ?').get(info.lastInsertRowid)
  );
});

// ── Imagem de capa do evento ──────────────────────────────────────────────────
// IMPORTANTE: rotas /cover vêm antes das rotas /:fid para não colidir.
// POST /api/events/:id/files/cover
router.post('/cover', requirePerm('can_edit'), upload.single('cover'), (req, res) => {
  const eventId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' });
  if (!/^image\//.test(req.file.mimetype) || req.file.mimetype === 'image/svg+xml') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'A capa deve ser uma imagem (JPG, PNG, WebP).' });
  }
  const ev = db.prepare('SELECT cover_image FROM events WHERE id = ?').get(eventId);
  if (!ev) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Evento não encontrado.' }); }
  if (ev.cover_image) removeStoredFile(ev.cover_image);
  db.prepare("UPDATE events SET cover_image = ?, updated_at = datetime('now') WHERE id = ?").run(req.file.filename, eventId);
  logActivity(req.admin.name || req.admin.email, 'definiu imagem de capa', null);
  res.status(201).json({ ok: true });
});

// GET /api/events/:id/files/cover — serve a capa (inline)
router.get('/cover', requirePerm('can_view'), (req, res) => {
  const ev = db.prepare('SELECT cover_image FROM events WHERE id = ?').get(Number(req.params.id));
  if (!ev || !ev.cover_image) return res.status(404).json({ error: 'Sem capa.' });
  const filePath = path.join(uploadsDir, ev.cover_image);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.sendFile(filePath);
});

// DELETE /api/events/:id/files/cover
router.delete('/cover', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const ev = db.prepare('SELECT cover_image FROM events WHERE id = ?').get(eventId);
  if (ev && ev.cover_image) {
    removeStoredFile(ev.cover_image);
    db.prepare('UPDATE events SET cover_image = NULL WHERE id = ?').run(eventId);
  }
  res.json({ ok: true });
});

// GET /api/events/:id/files/:fid/view — pré-visualização inline (imagens e PDF)
router.get('/:fid/view', requirePerm('can_view'), (req, res) => {
  const f = db.prepare('SELECT * FROM event_files WHERE id = ? AND event_id = ?').get(
    Number(req.params.fid), Number(req.params.id)
  );
  if (!f) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const filePath = path.join(uploadsDir, f.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
  const mime = f.mime_type || 'application/octet-stream';
  // Sandbox para neutralizar qualquer script embutido (defesa contra XSS).
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; object-src 'none'; sandbox");
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', 'inline');
  fs.createReadStream(filePath).pipe(res);
});

// GET /api/events/:id/files/:fid/download
router.get('/:fid/download', requirePerm('can_view'), (req, res) => {
  const f = db.prepare('SELECT * FROM event_files WHERE id = ? AND event_id = ?').get(
    Number(req.params.fid), Number(req.params.id)
  );
  if (!f) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const filePath = path.join(uploadsDir, f.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
  res.download(filePath, f.filename);
});

// DELETE /api/events/:id/files/:fid
router.delete('/:fid', requirePerm('can_files'), (req, res) => {
  const f = db.prepare('SELECT * FROM event_files WHERE id = ? AND event_id = ?').get(
    Number(req.params.fid), Number(req.params.id)
  );
  if (!f) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  removeStoredFile(f.stored_name);
  db.prepare('DELETE FROM event_files WHERE id = ?').run(f.id);
  touchEvent(Number(req.params.id));
  logActivity(req.admin.name || req.admin.email, 'excluiu arquivo', f.filename);
  res.json({ ok: true });
});

module.exports = router;
