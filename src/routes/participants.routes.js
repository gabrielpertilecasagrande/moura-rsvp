const express = require('express');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { normalizeName } = require('../utils/normalize');
const { logActivity } = require('../utils/activity');
const { parseFormConfig, customFields, sanitizeAnswer, extraValueToText } = require('../utils/formConfig');
const { requirePerm } = require('../utils/permissions');

// Mescla as respostas de campos personalizados recebidas no corpo com as já salvas.
function mergeExtra(prevRaw, eventCfg, bodyExtra) {
  let prev = {};
  try { prev = prevRaw ? JSON.parse(prevRaw) : {}; } catch { prev = {}; }
  if (!bodyExtra || typeof bodyExtra !== 'object') return prevRaw || null;
  const out = { ...prev };
  for (const f of customFields(eventCfg)) {
    if (Object.prototype.hasOwnProperty.call(bodyExtra, f.key)) {
      const v = sanitizeAnswer(f, bodyExtra[f.key]);
      if (v != null) out[f.key] = v; else delete out[f.key];
    }
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// Normaliza o campo de observações internas (texto simples, limite generoso).
function sanitizeNotes(v) {
  if (v == null) return undefined; // undefined = não alterar
  const s = String(v).trim().slice(0, 2000);
  return s || null;
}

// Localiza participante existente por prioridade: e-mail > telefone > nome.
function findDup(eventId, { email, phone, normalized }) {
  if (email && email.trim()) {
    const r = db.prepare('SELECT * FROM participants WHERE event_id = ? AND lower(email) = lower(?)').get(eventId, email.trim());
    if (r) return r;
  }
  if (phone && String(phone).replace(/\D/g, '')) {
    const d = String(phone).replace(/\D/g, '');
    const r = db.prepare("SELECT * FROM participants WHERE event_id = ? AND replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','') = ?").get(eventId, d);
    if (r) return r;
  }
  return db.prepare('SELECT * FROM participants WHERE event_id = ? AND name_normalized = ?').get(eventId, normalized);
}

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// Monta a consulta de participantes respeitando filtro de status e busca por nome.
function queryParticipants(eventId, { filter, q, ids }) {
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
  // Exportar selecionados: lista de ids separada por vírgula.
  if (ids && String(ids).trim()) {
    const list = String(ids).split(',').map((n) => parseInt(n, 10)).filter(Boolean);
    if (list.length) {
      sql += ` AND id IN (${list.map(() => '?').join(',')})`;
      params.push(...list);
    }
  }
  sql += ' ORDER BY name COLLATE NOCASE ASC';
  return db.prepare(sql).all(...params);
}

// GET /api/events/:id/participants?filter=&q=
router.get('/', requirePerm('can_view'), (req, res) => {
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

// DELETE /api/events/:id/participants/:pid — remove participante
router.delete('/:pid', requirePerm('can_participants'), (req, res) => {
  const eventId = Number(req.params.id);
  const pid = Number(req.params.pid);
  const p = db.prepare('SELECT * FROM participants WHERE id = ? AND event_id = ?').get(pid, eventId);
  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
  db.prepare('DELETE FROM participants WHERE id = ?').run(pid);
  logActivity(req.admin.name || req.admin.email, 'removeu participante', `${p.name}`);
  res.json({ ok: true });
});

// POST /api/events/:id/participants/mass — ações em massa (confirmar/recusar/excluir)
router.post('/mass', requirePerm('can_participants'), (req, res) => {
  const eventId = Number(req.params.id);
  const e = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const action = req.body?.action;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos um participante.' });
  const actor = req.admin.name || req.admin.email || 'Administrador';
  const placeholders = ids.map(() => '?').join(',');
  // Garante que todos pertencem a este evento.
  const rows = db.prepare(`SELECT id, name, response FROM participants WHERE event_id = ? AND id IN (${placeholders})`).all(eventId, ...ids);
  if (!rows.length) return res.status(404).json({ error: 'Nenhum participante encontrado.' });
  const validIds = rows.map((r) => r.id);
  const ph2 = validIds.map(() => '?').join(',');

  if (action === 'confirmar' || action === 'recusar') {
    const resp = action === 'confirmar' ? 'confirmado' : 'recusado';
    db.prepare(`UPDATE participants SET response = ?, updated_at = datetime('now') WHERE id IN (${ph2})`).run(resp, ...validIds);
    const auditStmt = db.prepare(`INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details) VALUES (?,?, 'editou', ?, ?, ?, 'Ação em massa')`);
    for (const r of rows) if (r.response !== resp) auditStmt.run(r.id, eventId, actor, r.response, resp);
    logActivity(actor, `alterou ${validIds.length} participante(s) para ${resp === 'confirmado' ? 'Confirmado' : 'Recusado'}`, null);
    return res.json({ ok: true, affected: validIds.length });
  }
  if (action === 'excluir') {
    db.prepare(`DELETE FROM participants WHERE id IN (${ph2})`).run(...validIds);
    logActivity(actor, `removeu ${validIds.length} participante(s)`, null);
    return res.json({ ok: true, affected: validIds.length });
  }
  return res.status(400).json({ error: 'Ação inválida.' });
});

// GET /api/events/:id/participants/:pid/audit — histórico de alterações
router.get('/:pid/audit', requirePerm('can_history'), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM audit_log WHERE participant_id = ? ORDER BY created_at ASC'
  ).all(req.params.pid);
  res.json(rows);
});

// PUT /api/events/:id/participants/:pid — admin edita dados/resposta do participante
router.put('/:pid', requirePerm('can_participants'), (req, res) => {
  const eventId = Number(req.params.id);
  const pid = Number(req.params.pid);
  const p = db.prepare('SELECT * FROM participants WHERE id = ? AND event_id = ?').get(pid, eventId);
  if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
  const ev = db.prepare('SELECT form_config FROM events WHERE id = ?').get(eventId);
  const cfg = parseFormConfig(ev ? ev.form_config : '{}');

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

  const extraJson = mergeExtra(p.extra, cfg, b.extra);
  if ((extraJson || '') !== (p.extra || '')) changes.push('campos personalizados');

  // Observações internas (não alterar quando o campo não vier no corpo).
  const notesNew = sanitizeNotes(b.notes);
  const notes = notesNew === undefined ? (p.notes || null) : notesNew;
  if (notesNew !== undefined && (notes || '') !== (p.notes || '')) changes.push('observações internas');

  if (!changes.length) {
    return res.json({ ok: true, unchanged: true, participant: p });
  }

  db.prepare(
    `UPDATE participants
       SET name = ?, name_normalized = ?, company = ?, role = ?, email = ?, phone = ?, response = ?,
           extra = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, normalized, company, role, email, phone, response, extraJson, notes, pid);

  db.prepare(
    `INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
     VALUES (?, ?, 'editou', ?, ?, ?, ?)`
  ).run(pid, eventId, req.admin.name || req.admin.email || 'Administrador', p.response, response,
    'Edição manual — ' + changes.join('; '));

  // Registro geral: separa "alteração de status" de "alteração de dados".
  const actor = req.admin.name || req.admin.email;
  if (response !== p.response) {
    logActivity(actor, 'alterou status de participante', `${name}: ${label(p.response)} → ${label(response)}`);
  }
  if (changes.some((c) => !c.startsWith('resposta:'))) {
    logActivity(actor, 'editou dados de participante', name);
  }

  res.json({ ok: true, participant: db.prepare('SELECT * FROM participants WHERE id = ?').get(pid) });
});

// POST /api/events/:id/participants — inclusão manual de um participante
router.post('/', requirePerm('can_participants'), (req, res) => {
  const eventId = Number(req.params.id);
  const e = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do participante.' });
  const response = b.response === 'recusado' ? 'recusado' : 'confirmado';
  const normalized = normalizeName(name);
  const evRow = db.prepare('SELECT form_config FROM events WHERE id = ?').get(eventId);
  const cfg = parseFormConfig(evRow ? evRow.form_config : '{}');
  const newExtra = mergeExtra(null, cfg, b.extra);

  const existing = findDup(eventId, { email: b.email, phone: b.phone, normalized });
  if (existing && !b.force_update) {
    return res.status(409).json({
      error: 'Este participante já existe. Deseja atualizar o cadastro existente?',
      duplicate: true, participant_id: existing.id, matched_name: existing.name,
    });
  }
  if (existing && b.force_update) {
    db.prepare(`UPDATE participants SET name=?, name_normalized=?, company=?, role=?, email=?, phone=?, response=?, extra=?, updated_at=datetime('now') WHERE id=?`)
      .run(name, normalized, b.company || null, b.role || null, b.email || null, b.phone || null, response, mergeExtra(existing.extra, cfg, b.extra), existing.id);
    db.prepare(`INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details) VALUES (?,?,'editou',?,?,?,?)`)
      .run(existing.id, eventId, req.admin.name || req.admin.email || 'Administrador', existing.response, response, 'Atualização de cadastro existente (inclusão manual)');
    return res.json({ ok: true, updated: true, participant: db.prepare('SELECT * FROM participants WHERE id=?').get(existing.id) });
  }

  const newNotes = sanitizeNotes(b.notes);
  const info = db.prepare(
    `INSERT INTO participants (event_id, name, name_normalized, company, role, email, phone, response, extra, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(eventId, name, normalized, b.company || null, b.role || null, b.email || null, b.phone || null, response, newExtra, newNotes === undefined ? null : newNotes);

  db.prepare(
    `INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
     VALUES (?,?, 'criou', ?, NULL, ?, ?)`
  ).run(info.lastInsertRowid, eventId, req.admin.name || req.admin.email || 'Administrador', response,
    'Inclusão manual pelo administrador');

  logActivity(req.admin.name || req.admin.email, 'incluiu participante manualmente', name);
  res.status(201).json({ ok: true, participant: db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid) });
});

// POST /api/events/:id/participants/bulk — inclusão em lote (colar lista)
// Cada linha: Nome[ , email ][ , empresa ][ , cargo ][ , telefone ]  (vírgula, ponto-e-vírgula ou tab)
router.post('/bulk', requirePerm('can_participants'), (req, res) => {
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
    const dup = findDup(eventId, { email: cols[1], phone: cols[4], normalized });
    if (dup) { skipped.push(name); continue; }
    const info = insert.run(eventId, name, normalized, cols[2] || null, cols[3] || null, cols[1] || null, cols[4] || null, response);
    audit.run(info.lastInsertRowid, eventId, actor, response, 'Inclusão em lote pelo administrador');
    added++;
  }
  logActivity(actor, 'incluiu participantes em lote', `${added} incluído(s)`);
  res.status(201).json({ ok: true, added, skipped, skipped_count: skipped.length });
});

// GET /api/events/:id/participants/export?format=xlsx|csv|pdf&filter=&q=&ids=
// Colunas opcionais aparecem só se habilitadas. Suporta exportar selecionados (ids).
const LOGO_PATH = require('path').join(__dirname, '..', '..', 'public', 'assets', 'img', 'logo-moura.png');

router.get('/export', requirePerm('can_export'), async (req, res) => {
  const eventId = req.params.id;
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const cfg = parseFormConfig(e.form_config);
  const fmtDateTime = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR') : '');
  const fmtDateOnly = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR') : '');
  const getExtra = (r, f) => { try { return extraValueToText(f, (JSON.parse(r.extra || '{}') || {})[f.key]); } catch { return ''; } };

  // Colunas de dados (sem status — status vira seção/aba separada), na ordem configurada.
  const cols = [{ key: 'name', header: 'Nome', width: 30, get: (r) => r.name }];
  for (const f of cfg.fields) {
    if (!f.enabled) continue;
    if (f.builtin) {
      const widths = { company: 24, role: 20, email: 28, phone: 18 };
      cols.push({ key: f.key, header: f.label, width: widths[f.key] || 20, get: (r) => r[f.key] || '' });
    } else {
      cols.push({ key: f.key, header: f.label, width: 22, get: (r) => getExtra(r, f) });
    }
  }
  cols.push({ key: 'date', header: 'Data da resposta', width: 20, get: (r) => fmtDateTime(r.updated_at) });
  // Observações internas (uso administrativo): só entram se houver alguma preenchida.
  const hasNotes = db.prepare("SELECT COUNT(*) c FROM participants WHERE event_id = ? AND notes IS NOT NULL AND notes <> ''").get(eventId).c > 0;
  if (hasNotes) cols.push({ key: 'notes', header: 'Observações internas', width: 30, get: (r) => r.notes || '' });

  const rows = queryParticipants(eventId, req.query);
  const confirmados = rows.filter((r) => r.response === 'confirmado');
  const recusados = rows.filter((r) => r.response === 'recusado');
  const safeName = (e.slug || 'evento').replace(/[^a-z0-9-]/gi, '');
  const format = (req.query.format || 'xlsx').toLowerCase();
  const emitido = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const localLinha = [e.location, e.city].filter(Boolean).join(' - ');
  const subtitulo = [fmtDateOnly(e.event_date), localLinha].filter(Boolean).join(' • ');
  logActivity(req.admin.name || req.admin.email, `exportou ${format.toUpperCase()}`, e.name);

  if (format === 'csv') {
    const colsCsv = [...cols, { header: 'Status', get: (r) => (r.response === 'confirmado' ? 'Confirmado' : 'Recusado') }];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [colsCsv.map((c) => esc(c.header)).join(';')];
    for (const r of rows) lines.push(colsCsv.map((c) => esc(c.get(r))).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.csv"`);
    return res.send('\uFEFF' + lines.join('\r\n'));
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.pdf"`);
    doc.pipe(res);
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // Cabeçalho: nome + subtítulo à esquerda, logo Moura no canto superior direito
    try { doc.image(LOGO_PATH, doc.page.width - doc.page.margins.right - 110, 36, { width: 110 }); } catch { /* sem logo */ }
    doc.fontSize(18).fillColor('#2C427E').text(e.name || 'Evento', left, 40, { width: pageW - 130 });
    if (subtitulo) doc.moveDown(0.2).fontSize(10).fillColor('#5b6472').text(subtitulo, { width: pageW - 130 });

    // Bloco RESUMO DO EVENTO
    let y = 92;
    doc.roundedRect(left, y, pageW, 58, 6).fill('#F2F3F3');
    doc.fillColor('#2C427E').fontSize(10).text('RESUMO DO EVENTO', left + 14, y + 9);
    doc.fontSize(11).fillColor('#28282A');
    const sumItems = [
      ['Respostas recebidas', String(rows.length)],
      ['Confirmados', String(confirmados.length)],
      ['Recusas', String(recusados.length)],
      ['Emitido em', emitido],
    ];
    const colw = (pageW - 28) / 4;
    sumItems.forEach(([k, v], i) => {
      const cx = left + 14 + i * colw;
      doc.fontSize(8).fillColor('#5b6472').text(k.toUpperCase(), cx, y + 26, { width: colw - 8 });
      doc.fontSize(14).fillColor(i === 2 && recusados.length ? '#c0392b' : (i === 1 ? '#1f9d63' : '#2C427E'))
        .text(v, cx, y + 36, { width: colw - 8 });
    });
    y += 74;

    const drawTable = (titulo, data, cor) => {
      if (y + 60 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
      doc.fontSize(12).fillColor(cor).text(`${titulo} (${data.length})`, left, y);
      y += 20;
      const totalW = cols.reduce((s, c) => s + c.width, 0);
      const colX = []; let x = left;
      for (const c of cols) { colX.push(x); x += (c.width / totalW) * pageW; }
      const cellW = cols.map((c) => (c.width / totalW) * pageW - 6);
      const rowH = 18;
      const headRow = (yy) => {
        doc.rect(left, yy, pageW, rowH).fill(cor);
        doc.fillColor('#FFFFFF').fontSize(8.5);
        cols.forEach((c, i) => doc.text(c.header, colX[i] + 3, yy + 5, { width: cellW[i], lineBreak: false }));
        return yy + rowH;
      };
      y = headRow(y);
      if (!data.length) {
        doc.fillColor('#5b6472').fontSize(9).text('Nenhum registro.', left + 3, y + 4); y += rowH; doc.moveDown(0.5); y += 8; return;
      }
      data.forEach((r, idx) => {
        if (y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = headRow(doc.page.margins.top); }
        if (idx % 2 === 0) doc.rect(left, y, pageW, rowH).fill('#F7F8FA');
        doc.fillColor('#28282A').fontSize(8.5);
        cols.forEach((c, i) => doc.text(String(c.get(r) || ''), colX[i] + 3, y + 5, { width: cellW[i], lineBreak: false, ellipsis: true }));
        y += rowH;
      });
      y += 14;
    };

    drawTable('Confirmados', confirmados, '#1f9d63');
    drawTable('Recusados', recusados, '#c0392b');

    // Rodapé institucional
    const fy = doc.page.height - doc.page.margins.bottom + 6;
    doc.fontSize(8).fillColor('#9aa3b2')
      .text(`Moura RSVP · Plataforma de confirmação de presença · Relatório gerado em ${emitido} · Desenvolvido por Moura Agência de Relações Públicas`,
        left, fy, { width: pageW, align: 'center' });
    doc.end();
    return;
  }

  // XLSX com 4 abas: Resumo, Todos, Confirmados, Recusados
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Moura RSVP';

  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 28 }, { width: 40 }];
  resumo.addRow([e.name || 'Evento']); resumo.getRow(1).font = { bold: true, size: 16, color: { argb: 'FF2C427E' } };
  if (subtitulo) { resumo.addRow([subtitulo]); resumo.getRow(2).font = { color: { argb: 'FF5B6472' } }; }
  resumo.addRow([]);
  const addKV = (k, v, color) => { const r = resumo.addRow([k, v]); r.getCell(1).font = { bold: true }; if (color) r.getCell(2).font = { bold: true, color: { argb: color } }; };
  addKV('Respostas recebidas', rows.length);
  addKV('Confirmados', confirmados.length, 'FF1F9D63');
  addKV('Recusas', recusados.length, 'FFC0392B');
  addKV('Emitido em', emitido);

  const buildSheet = (name, data, headerColor) => {
    const ws = wb.addWorksheet(name);
    const allCols = [...cols.filter((c) => c.key !== 'date'),
      { key: 'status', header: 'Status', width: 14, get: (r) => (r.response === 'confirmado' ? 'Confirmado' : 'Recusado') },
      { key: 'date', header: 'Data da resposta', width: 20, get: (r) => fmtDateTime(r.updated_at) }];
    ws.columns = allCols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
    data.forEach((r) => { const obj = {}; allCols.forEach((c) => { obj[c.key] = c.get(r); }); ws.addRow(obj); });
  };
  buildSheet('Todos', rows, 'FF2C427E');
  buildSheet('Confirmados', confirmados, 'FF1F9D63');
  buildSheet('Recusados', recusados, 'FFC0392B');

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
