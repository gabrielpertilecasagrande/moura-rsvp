const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { normalizeName } = require('../utils/normalize');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// Monta a consulta de participantes respeitando filtro de status e busca por nome.
function queryParticipants(eventId, { filter, q }) {
  let sql = 'SELECT * FROM participants WHERE event_id = ?';
  const params = [eventId];
  if (filter === 'confirmado' || filter === 'recusado') {
    sql += ' AND response = ?';
    params.push(filter);
  }
  if (q && q.trim()) {
    sql += ' AND name LIKE ?';
    params.push(`%${q.trim()}%`);
  }
  sql += ' ORDER BY name COLLATE NOCASE ASC';
  return db.prepare(sql).all(...params);
}

// GET /api/events/:id/participants?filter=&q=
router.get('/', (req, res) => {
  const eventId = req.params.id;
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const list = queryParticipants(eventId, req.query);
  const confirmed = db.prepare("SELECT COUNT(*) c FROM participants WHERE event_id=? AND response='confirmado'").get(eventId).c;
  const declined = db.prepare("SELECT COUNT(*) c FROM participants WHERE event_id=? AND response='recusado'").get(eventId).c;
  const total = confirmed + declined;
  const rate = total ? Math.round((confirmed / total) * 100) : 0;

  res.json({
    stats: { total, confirmed, declined, confirmation_rate: rate, expected_guests: e.expected_guests || 0,
      pending: Math.max(0, (e.expected_guests || 0) - total) },
    participants: list,
  });
});

// GET /api/events/:id/participants/:pid/audit — histórico de alterações
router.get('/:pid/audit', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM audit_log WHERE participant_id = ? ORDER BY created_at ASC'
  ).all(req.params.pid);
  res.json(rows);
});

// PUT /api/events/:id/participants/:pid — admin edita dados/resposta do participante
router.put('/:pid', (req, res) => {
  const eventId = Number(req.params.id);
  const pid = Number(req.params.pid);
  const p = db.prepare('SELECT * FROM participants WHERE id = ? AND event_id = ?').get(pid, eventId);
  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });

  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : p.name;
  if (!name) return res.status(400).json({ error: 'O nome é obrigatório.' });
  const company = b.company != null ? String(b.company).trim() : p.company;
  const role = b.role != null ? String(b.role).trim() : p.role;
  const email = b.email != null ? String(b.email).trim() : p.email;
  const phone = b.phone != null ? String(b.phone).trim() : p.phone;
  let response = p.response;
  if (b.response === 'confirmado' || b.response === 'recusado') response = b.response;

  const normalized = normalizeName(name);
  // Verifica conflito de nome com OUTRO participante do mesmo evento.
  const clash = db
    .prepare('SELECT id FROM participants WHERE event_id = ? AND name_normalized = ? AND id <> ?')
    .get(eventId, normalized, pid);
  if (clash) {
    return res.status(409).json({ error: 'Já existe outro participante com este nome neste evento.' });
  }

  // Monta descrição das mudanças para o histórico.
  const changes = [];
  const label = (r) => (r === 'confirmado' ? 'Confirmado' : 'Recusado');
  if (name !== p.name) changes.push(`nome: "${p.name}" → "${name}"`);
  if ((company || '') !== (p.company || '')) changes.push(`empresa: "${p.company || ''}" → "${company || ''}"`);
  if ((role || '') !== (p.role || '')) changes.push(`cargo: "${p.role || ''}" → "${role || ''}"`);
  if ((email || '') !== (p.email || '')) changes.push(`e-mail: "${p.email || ''}" → "${email || ''}"`);
  if ((phone || '') !== (p.phone || '')) changes.push(`telefone: "${p.phone || ''}" → "${phone || ''}"`);
  if (response !== p.response) changes.push(`resposta: ${label(p.response)} → ${label(response)}`);

  if (!changes.length) {
    return res.json({ ok: true, unchanged: true, participant: p });
  }

  db.prepare(
    `UPDATE participants
       SET name = ?, name_normalized = ?, company = ?, role = ?, email = ?, phone = ?, response = ?,
           updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, normalized, company, role, email, phone, response, pid);

  db.prepare(
    `INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
     VALUES (?, ?, 'editou', ?, ?, ?, ?)`
  ).run(pid, eventId, req.admin.name || req.admin.email || 'Administrador', p.response, response,
    'Edição manual — ' + changes.join('; '));

  res.json({ ok: true, participant: db.prepare('SELECT * FROM participants WHERE id = ?').get(pid) });
});

// POST /api/events/:id/participants — inclusão manual de um participante
router.post('/', (req, res) => {
  const eventId = Number(req.params.id);
  const e = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do participante.' });
  const response = b.response === 'recusado' ? 'recusado' : 'confirmado';
  const normalized = normalizeName(name);

  const existing = db.prepare('SELECT id FROM participants WHERE event_id = ? AND name_normalized = ?').get(eventId, normalized);
  if (existing) return res.status(409).json({ error: 'Já existe um participante com este nome neste evento.' });

  const info = db.prepare(
    `INSERT INTO participants (event_id, name, name_normalized, company, role, email, phone, response)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(eventId, name, normalized, b.company || null, b.role || null, b.email || null, b.phone || null, response);

  db.prepare(
    `INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
     VALUES (?,?, 'criou', ?, NULL, ?, ?)`
  ).run(info.lastInsertRowid, eventId, req.admin.name || req.admin.email || 'Administrador', response,
    'Inclusão manual pelo administrador');

  res.status(201).json({ ok: true, participant: db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid) });
});

// POST /api/events/:id/participants/bulk — inclusão em lote (colar lista)
// Cada linha: Nome[ , email ][ , empresa ][ , cargo ][ , telefone ]  (vírgula, ponto-e-vírgula ou tab)
router.post('/bulk', (req, res) => {
  const eventId = Number(req.params.id);
  const e = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const text = String(req.body?.text || '');
  const response = req.body?.response === 'recusado' ? 'recusado' : 'confirmado';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: 'Cole ao menos um nome.' });

  const insert = db.prepare(
    `INSERT INTO participants (event_id, name, name_normalized, company, role, email, phone, response)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const audit = db.prepare(
    `INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
     VALUES (?,?, 'criou', ?, NULL, ?, ?)`
  );
  const actor = req.admin.name || req.admin.email || 'Administrador';

  let added = 0; const skipped = [];
  for (const line of lines) {
    const cols = line.split(/[;,\t]/).map((c) => c.trim());
    const name = cols[0];
    if (!name) continue;
    const normalized = normalizeName(name);
    const dup = db.prepare('SELECT id FROM participants WHERE event_id = ? AND name_normalized = ?').get(eventId, normalized);
    if (dup) { skipped.push(name); continue; }
    const info = insert.run(eventId, name, normalized, cols[2] || null, cols[3] || null, cols[1] || null, cols[4] || null, response);
    audit.run(info.lastInsertRowid, eventId, actor, response, 'Inclusão em lote pelo administrador');
    added++;
  }
  res.status(201).json({ ok: true, added, skipped, skipped_count: skipped.length });
});

// GET /api/events/:id/participants/export?format=xlsx|csv|pdf&filter=&q=
// As colunas opcionais (Empresa, Cargo, E-mail, Telefone) só aparecem se habilitadas no evento.
router.get('/export', async (req, res) => {
  const eventId = req.params.id;
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  let fc = {};
  try { fc = JSON.parse(e.form_config || '{}'); } catch { fc = {}; }
  const on = (k) => fc[k] && fc[k].enabled;
  const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR') : '');

  // Colunas dinâmicas conforme campos habilitados no evento.
  const cols = [{ key: 'name', header: 'Nome', width: 30, get: (r) => r.name }];
  if (on('company')) cols.push({ key: 'company', header: 'Empresa', width: 24, get: (r) => r.company || '' });
  if (on('role')) cols.push({ key: 'role', header: 'Cargo', width: 20, get: (r) => r.role || '' });
  if (on('email')) cols.push({ key: 'email', header: 'E-mail', width: 28, get: (r) => r.email || '' });
  if (on('phone')) cols.push({ key: 'phone', header: 'Telefone', width: 18, get: (r) => r.phone || '' });
  cols.push({ key: 'status', header: 'Status', width: 14, get: (r) => (r.response === 'confirmado' ? 'Confirmado' : 'Recusado') });
  cols.push({ key: 'date', header: 'Data da resposta', width: 20, get: (r) => fmtDate(r.updated_at) });

  const rows = queryParticipants(eventId, req.query);
  const safeName = (e.slug || 'evento').replace(/[^a-z0-9-]/gi, '');
  const format = (req.query.format || 'xlsx').toLowerCase();

  if (format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map((c) => esc(c.header)).join(';')];
    for (const r of rows) lines.push(cols.map((c) => esc(c.get(r))).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.csv"`);
    return res.send('\uFEFF' + lines.join('\r\n'));
  }

  if (format === 'pdf') {
    const confirmed = rows.filter((r) => r.response === 'confirmado').length;
    const declined = rows.length - confirmed;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).fillColor('#2C427E').text(e.name || 'Evento', { continued: false });
    doc.moveDown(0.2);
    const meta = [e.event_date ? `Data: ${fmtDate(e.event_date).split(' ')[0] || e.event_date}` : null,
      e.location ? `Local: ${e.location}` : null].filter(Boolean).join('   ·   ');
    if (meta) doc.fontSize(10).fillColor('#5b6472').text(meta);
    doc.fontSize(10).fillColor('#28282A').text(
      `Lista de presença · ${rows.length} resposta(s) · ${confirmed} confirmada(s) · ${declined} recusa(s)`);
    doc.moveDown(0.6);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalW = cols.reduce((s, c) => s + c.width, 0);
    const colX = []; let x = doc.page.margins.left;
    for (const c of cols) { colX.push(x); x += (c.width / totalW) * pageW; }
    const cellW = cols.map((c) => (c.width / totalW) * pageW - 6);
    const rowH = 20;

    function header(y) {
      doc.rect(doc.page.margins.left, y, pageW, rowH).fill('#2C427E');
      doc.fillColor('#FFFFFF').fontSize(9);
      cols.forEach((c, i) => doc.text(c.header, colX[i] + 3, y + 6, { width: cellW[i], lineBreak: false }));
      return y + rowH;
    }
    let y = header(doc.y);
    rows.forEach((r, idx) => {
      if (y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = header(doc.page.margins.top); }
      if (idx % 2 === 0) { doc.rect(doc.page.margins.left, y, pageW, rowH).fill('#F2F3F3'); }
      doc.fillColor('#28282A').fontSize(8.5);
      cols.forEach((c, i) => doc.text(String(c.get(r) || ''), colX[i] + 3, y + 6, { width: cellW[i], lineBreak: false, ellipsis: true }));
      y += rowH;
    });
    doc.end();
    return;
  }

  // XLSX (padrão)
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Participantes');
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C427E' } };
  for (const r of rows) {
    const obj = {};
    cols.forEach((c) => { obj[c.key] = c.get(r); });
    ws.addRow(obj);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
