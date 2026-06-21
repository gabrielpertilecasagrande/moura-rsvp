// LGPD — Direito ao esquecimento para participantes do RSVP.
//
// Permite ao admin localizar participantes por nome/e-mail/telefone,
// excluí-los PERMANENTEMENTE, registrar num log de auditoria e emitir
// comprovante em PDF.
//
// Restrição: apenas admins. O contexto de banco (tenant) já é resolvido
// automaticamente pelo middleware de autenticação via AsyncLocalStorage.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const like = (q) => `%${String(q).trim().toLowerCase()}%`;

// ── Busca de participantes ────────────────────────────────────────────────────
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Digite ao menos 2 caracteres para buscar.' });
  const term = like(q);

  const rows = db.prepare(
    `SELECT p.id, p.name, p.email, p.phone, p.company, p.response,
            e.name AS event_name, e.id AS event_id
       FROM participants p JOIN events e ON e.id = p.event_id
      WHERE lower(p.name) LIKE ? OR lower(IFNULL(p.email,'')) LIKE ?
         OR lower(IFNULL(p.phone,'')) LIKE ?
      ORDER BY p.name COLLATE NOCASE ASC
      LIMIT 100`
  ).all(term, term, term);

  res.json({ participants: rows });
});

// ── Exclusão permanente ───────────────────────────────────────────────────────
function gid() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `LGPD-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

router.post('/erase', (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos um participante para excluir.' });

  const ph = ids.map(() => '?').join(',');
  const found = db.prepare(
    `SELECT p.id, p.name, p.email, e.name AS event_name
       FROM participants p JOIN events e ON e.id = p.event_id
      WHERE p.id IN (${ph})`
  ).all(...ids);

  if (!found.length) return res.status(404).json({ error: 'Nenhum participante encontrado.' });

  const summary = found.map((r) =>
    `Participante #${r.id} — ${r.name}${r.email ? ` (${r.email})` : ''} — evento "${r.event_name}"`
  );

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM participants WHERE id IN (${ph})`).run(...ids);

    const receipt = gid();
    const info = db.prepare(
      `INSERT INTO data_erasures (receipt_no, subject_name, subject_email, reason, summary, item_count, performed_by, performed_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      receipt,
      b.subject_name ? String(b.subject_name).slice(0, 160) : null,
      b.subject_email ? String(b.subject_email).slice(0, 160) : null,
      b.reason ? String(b.reason).slice(0, 500) : null,
      JSON.stringify(summary),
      found.length,
      req.admin.name || req.admin.email,
      req.context?.ip || req.ip || null,
    );
    return { id: info.lastInsertRowid, receipt };
  });

  let result;
  try { result = run(); }
  catch (e) { return res.status(500).json({ error: e.message || 'Falha ao excluir.' }); }

  logActivity(req.admin.name || req.admin.email, `executou exclusão de dados (LGPD) — ${found.length} participante(s)`, result.receipt);
  res.status(201).json({ ok: true, id: result.id, receipt_no: result.receipt, count: found.length });
});

// ── Auditoria das exclusões ───────────────────────────────────────────────────
router.get('/erasures', (_req, res) => {
  const rows = db.prepare('SELECT * FROM data_erasures ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map((r) => ({ ...r, summary: safeParse(r.summary) })));
});

function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }

// ── Comprovante em PDF ────────────────────────────────────────────────────────
router.get('/erasures/:id/receipt.pdf', (req, res) => {
  const r = db.prepare('SELECT * FROM data_erasures WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Comprovante não encontrado.' });
  const items = safeParse(r.summary);

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="comprovante-exclusao-${r.receipt_no}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).fillColor('#152C6B').text('Comprovante de Exclusão de Dados', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor('#555').text('Moura RSVP — Conformidade com a LGPD (Lei nº 13.709/2018)');
  doc.moveDown(1);

  const line = (k, v) => {
    doc.fontSize(11).fillColor('#111').text(`${k}: `, { continued: true }).fillColor('#333').text(v || '—');
  };
  line('Nº do comprovante', r.receipt_no);
  line('Data/hora', fmtBR(r.created_at));
  line('Titular dos dados', r.subject_name);
  line('E-mail do titular', r.subject_email);
  line('Motivo', r.reason);
  line('Executado por', r.performed_by);
  line('Registros excluídos', String(r.item_count));
  doc.moveDown(0.8);

  doc.fontSize(12).fillColor('#152C6B').text('Itens excluídos permanentemente:');
  doc.moveDown(0.3);
  doc.fontSize(10.5).fillColor('#333');
  if (items.length) items.forEach((it) => doc.text(`• ${it}`));
  else doc.text('—');

  doc.moveDown(1.5);
  doc.fontSize(9).fillColor('#777').text(
    'Este documento comprova que os dados pessoais listados foram removidos de forma permanente dos sistemas do Moura RSVP, ' +
    'em atendimento ao direito de eliminação previsto na Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018). ' +
    'O conteúdo dos dados não é retido; mantém-se apenas este registro de auditoria.',
    { align: 'justify' },
  );

  doc.end();
});

function fmtBR(s) {
  if (!s) return '—';
  try { return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return s; }
}

module.exports = router;
