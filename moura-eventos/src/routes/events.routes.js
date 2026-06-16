const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePerm, authorizedEventIds, grantFullAccess, normalizeRole } = require('../utils/permissions');
const { logActivity } = require('../utils/activity');
const { removeStoredFile } = require('../utils/uploads');

const router = express.Router();
router.use(requireAuth);

const EVENT_STATUS = ['Planejamento', 'Contratação', 'Produção', 'Evento realizado', 'Encerrado'];
const EVENT_TYPES  = ['Social', 'Social corporativo', 'Fórum', 'Congresso', 'Convenção', 'Feira', 'Seminário', 'Jantar', 'Lançamento', 'Reunião'];

// Insere as tarefas-modelo do tipo no checklist do evento. Retorna a quantidade.
function applyTemplate(eventId, type) {
  if (!type) return 0;
  const templates = db.prepare(
    'SELECT * FROM event_type_templates WHERE event_type = ? ORDER BY sort_order ASC'
  ).all(type);
  const insertTask = db.prepare(
    `INSERT INTO checklist (event_id, title, priority, responsible, status) VALUES (?, ?, ?, ?, 'Pendente')`
  );
  const insertAll = db.transaction((rows) => { for (const t of rows) insertTask.run(eventId, t.title, t.priority, t.responsible); });
  insertAll(templates);
  return templates.length;
}

// Rótulos amigáveis para o log de alterações.
const FIELD_LABELS = {
  name: 'nome', client: 'cliente', event_date: 'data', event_time: 'horário',
  location: 'local', city: 'cidade', responsible: 'responsável', status: 'status', event_type: 'tipo',
};

// GET /api/events
router.get('/', (req, res) => {
  const isAdmin = normalizeRole(req.admin.role) === 'admin';
  const ids = authorizedEventIds(req.admin);

  let where = 'WHERE 1=1';
  const params = [];

  if (!isAdmin && ids !== null) {
    if (ids.length === 0) return res.json([]);
    where += ` AND e.id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }

  const { q, status } = req.query;
  if (q) {
    where += ' AND (e.name LIKE ? OR e.client LIKE ? OR e.city LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (status) {
    where += ' AND e.status = ?';
    params.push(status);
  }

  const events = db.prepare(
    `SELECT e.*,
       (SELECT COUNT(*) FROM contracts c WHERE c.event_id = e.id) AS contracts_count,
       (SELECT COUNT(*) FROM checklist ch WHERE ch.event_id = e.id AND ch.status != 'Concluído') AS open_tasks
     FROM events e
     ${where}
     ORDER BY e.event_date DESC, e.created_at DESC`
  ).all(...params);

  res.json(events);
});

// POST /api/events
router.post('/', requireRole('admin', 'gestor'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });
  const status = EVENT_STATUS.includes(b.status) ? b.status : 'Planejamento';

  const event_type = EVENT_TYPES.includes(b.event_type) ? b.event_type : null;

  const info = db.prepare(
    `INSERT INTO events (name, client, event_date, event_time, location, city, responsible, status, event_type, rsvp_event_id, checkin_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(b.name).trim(),
    b.client   ? String(b.client).trim()   : null,
    b.event_date   || null,
    b.event_time   || null,
    b.location ? String(b.location).trim() : null,
    b.city     ? String(b.city).trim()     : null,
    b.responsible ? String(b.responsible).trim() : null,
    status,
    event_type,
    b.rsvp_event_id    ? String(b.rsvp_event_id).trim()    : null,
    b.checkin_event_id ? String(b.checkin_event_id).trim()  : null
  );

  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
  if (normalizeRole(req.admin.role) !== 'admin') {
    grantFullAccess(req.admin.id, event.id);
  }

  if (event_type) applyTemplate(event.id, event_type);

  logActivity(req.admin.name || req.admin.email, 'criou evento', event.name);
  res.status(201).json(event);
});

// GET /api/events/:id
router.get('/:id', requirePerm('can_view'), (req, res) => {
  const id = Number(req.params.id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) return res.status(404).json({ error: 'Evento não encontrado.' });

  const contracts = db.prepare(
    `SELECT c.*, s.company, s.category, s.whatsapp, s.email
     FROM contracts c JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.event_id = ? ORDER BY c.created_at DESC`
  ).all(id);

  const checklist = db.prepare(
    'SELECT * FROM checklist WHERE event_id = ? ORDER BY due_date ASC, created_at ASC'
  ).all(id);

  const files = db.prepare(
    'SELECT id, filename, mime_type, size, uploaded_by, category, created_at FROM event_files WHERE event_id = ? ORDER BY created_at DESC'
  ).all(id);

  const diary = db.prepare(
    'SELECT * FROM diary WHERE event_id = ? ORDER BY created_at DESC'
  ).all(id);

  const totalValue = contracts.reduce((s, c) => s + (c.value || 0), 0);

  res.json({ event, contracts, checklist, files, diary, totalValue });
});

// PUT /api/events/:id
router.put('/:id', requirePerm('can_edit'), (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : ev.name;
  if (!name) return res.status(400).json({ error: 'O nome do evento é obrigatório.' });
  const status = EVENT_STATUS.includes(b.status) ? b.status : ev.status;

  const event_type = b.event_type != null ? (EVENT_TYPES.includes(b.event_type) ? b.event_type : null) : ev.event_type;

  const next = {
    name,
    client:           b.client           != null ? (String(b.client).trim()           || null) : ev.client,
    event_date:       b.event_date        != null ? (b.event_date                      || null) : ev.event_date,
    event_time:       b.event_time        != null ? (b.event_time                      || null) : ev.event_time,
    location:         b.location          != null ? (String(b.location).trim()         || null) : ev.location,
    city:             b.city              != null ? (String(b.city).trim()             || null) : ev.city,
    responsible:      b.responsible       != null ? (String(b.responsible).trim()      || null) : ev.responsible,
    status,
    event_type,
    rsvp_event_id:    b.rsvp_event_id    != null ? (String(b.rsvp_event_id).trim()    || null) : ev.rsvp_event_id,
    checkin_event_id: b.checkin_event_id != null ? (String(b.checkin_event_id).trim()  || null) : ev.checkin_event_id,
  };

  db.prepare(
    `UPDATE events SET name=?, client=?, event_date=?, event_time=?, location=?, city=?, responsible=?, status=?, event_type=?, rsvp_event_id=?, checkin_event_id=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(next.name, next.client, next.event_date, next.event_time, next.location, next.city, next.responsible, next.status, next.event_type, next.rsvp_event_id, next.checkin_event_id, id);

  // Se o tipo foi definido agora e o checklist está vazio, aplica o modelo.
  if (next.event_type && !ev.event_type) {
    const hasTasks = db.prepare('SELECT COUNT(*) AS n FROM checklist WHERE event_id = ?').get(id).n;
    if (hasTasks === 0) applyTemplate(id, next.event_type);
  }

  // Monta o detalhe das mudanças para o log de auditoria.
  const changes = [];
  for (const k of Object.keys(FIELD_LABELS)) {
    const before = ev[k] == null ? '' : String(ev[k]);
    const after  = next[k] == null ? '' : String(next[k]);
    if (before !== after) changes.push(`${FIELD_LABELS[k]}: "${before || '—'}" → "${after || '—'}"`);
  }
  const detail = changes.length ? `${name} (${changes.join('; ')})` : name;
  logActivity(req.admin.name || req.admin.email, 'editou evento', detail);
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(id));
});

// POST /api/events/:id/apply-template — gera as tarefas do modelo do tipo atual
router.post('/:id/apply-template', requirePerm('can_checklist'), (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
  if (!ev.event_type) return res.status(400).json({ error: 'Defina o tipo do evento antes de gerar as tarefas do modelo.' });
  const n = applyTemplate(id, ev.event_type);
  logActivity(req.admin.name || req.admin.email, 'gerou tarefas do modelo', `${ev.name} (${ev.event_type}): ${n} tarefa(s)`);
  res.json({ ok: true, added: n });
});

// POST /api/events/:id/duplicate — duplica evento + checklist (status zerado)
router.post('/:id/duplicate', requireRole('admin', 'gestor'), requirePerm('can_view'), (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });

  const dup = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO events (name, client, event_date, event_time, location, city, responsible, status, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Planejamento', ?)`
    ).run(`${ev.name} (cópia)`, ev.client, ev.event_date, ev.event_time, ev.location, ev.city, ev.responsible, ev.event_type);
    const newId = info.lastInsertRowid;

    // Copia as tarefas do checklist, zerando status e datas de execução.
    const tasks = db.prepare('SELECT title, responsible, priority FROM checklist WHERE event_id = ?').all(id);
    const insTask = db.prepare(
      `INSERT INTO checklist (event_id, title, responsible, priority, status) VALUES (?, ?, ?, ?, 'Pendente')`
    );
    for (const t of tasks) insTask.run(newId, t.title, t.responsible, t.priority || 'Média');
    return newId;
  });

  const newId = dup();
  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(newId);
  if (normalizeRole(req.admin.role) !== 'admin') grantFullAccess(req.admin.id, newId);
  logActivity(req.admin.name || req.admin.email, 'duplicou evento', `${ev.name} → ${created.name}`);
  res.status(201).json(created);
});

// GET /api/events/templates/:type
router.get('/templates/:type', (req, res) => {
  const rows = db.prepare(
    'SELECT title, priority, responsible FROM event_type_templates WHERE event_type = ? ORDER BY sort_order ASC'
  ).all(req.params.type);
  res.json(rows);
});

// DELETE /api/events/:id
router.delete('/:id', requirePerm('can_delete'), (req, res) => {
  const id = Number(req.params.id);
  const ev = db.prepare('SELECT name FROM events WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
  // Remove os arquivos físicos antes do CASCADE apagar as linhas em event_files,
  // evitando arquivos órfãos acumulando no volume.
  const storedFiles = db.prepare('SELECT stored_name FROM event_files WHERE event_id = ?').all(id);
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  storedFiles.forEach((f) => removeStoredFile(f.stored_name));
  logActivity(req.admin.name || req.admin.email, 'excluiu evento', ev.name);
  res.json({ ok: true });
});

module.exports = router;
