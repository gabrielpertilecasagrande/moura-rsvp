const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

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

// GET /api/events/:id/participants/export?format=xlsx|csv&filter=&q=
router.get('/export', async (req, res) => {
  const eventId = req.params.id;
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const rows = queryParticipants(eventId, req.query);
  const headers = ['Nome', 'Empresa', 'Cargo', 'E-mail', 'Telefone', 'Status', 'Data da resposta'];
  const statusLabel = (r) => (r === 'confirmado' ? 'Confirmado' : 'Recusado');
  const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR') : '');
  const safeName = (e.slug || 'evento').replace(/[^a-z0-9-]/gi, '');

  if (req.query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.map(esc).join(';')];
    for (const r of rows) {
      lines.push([r.name, r.company, r.role, r.email, r.phone, statusLabel(r.response), fmtDate(r.updated_at)].map(esc).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.csv"`);
    return res.send('\uFEFF' + lines.join('\r\n')); // BOM p/ acentuação no Excel
  }

  // XLSX
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Participantes');
  ws.columns = [
    { header: 'Nome', key: 'name', width: 30 },
    { header: 'Empresa', key: 'company', width: 24 },
    { header: 'Cargo', key: 'role', width: 20 },
    { header: 'E-mail', key: 'email', width: 28 },
    { header: 'Telefone', key: 'phone', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Data da resposta', key: 'date', width: 20 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C427E' } };
  for (const r of rows) {
    ws.addRow({ name: r.name, company: r.company, role: r.role, email: r.email,
      phone: r.phone, status: statusLabel(r.response), date: fmtDate(r.updated_at) });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="rsvp-${safeName}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
