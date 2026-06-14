// Rotas públicas (sem autenticação) — usadas pela página /rsvp/:slug
const express = require('express');
const db = require('../db');
const { normalizeName } = require('../utils/normalize');

const router = express.Router();

const DEFAULT_FORM_CONFIG = {
  company: { enabled: false, required: false, label: 'Empresa' },
  role: { enabled: false, required: false, label: 'Cargo' },
  email: { enabled: false, required: false, label: 'E-mail' },
  phone: { enabled: false, required: false, label: 'Telefone/WhatsApp' },
};
const parseFormConfig = (raw) => {
  try { return { ...DEFAULT_FORM_CONFIG, ...(JSON.parse(raw || '{}')) }; }
  catch { return { ...DEFAULT_FORM_CONFIG }; }
};

function deadlinePassed(deadline) {
  if (!deadline) return false;
  // compara apenas a data (fim do dia da data limite)
  const end = new Date(`${deadline}T23:59:59`);
  return Date.now() > end.getTime();
}

// GET /api/public/events/:slug  — dados públicos do evento
router.get('/events/:slug', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const closed = e.status !== 'ativo' || deadlinePassed(e.rsvp_deadline);
  res.json({
    slug: e.slug,
    name: e.name,
    description: e.description,
    event_date: e.event_date,
    event_time: e.event_time,
    location: e.location,
    cover_image: e.cover_image,
    client_logo: e.client_logo,
    rsvp_deadline: e.rsvp_deadline,
    whatsapp: e.whatsapp || null,
    form_config: parseFormConfig(e.form_config),
    closed,
    closed_reason: e.status !== 'ativo' ? 'inativo' : (deadlinePassed(e.rsvp_deadline) ? 'prazo' : null),
  });
});

// POST /api/public/events/:slug/rsvp  — registra ou atualiza resposta
router.post('/events/:slug/rsvp', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  if (e.status !== 'ativo' || deadlinePassed(e.rsvp_deadline)) {
    return res.status(403).json({ error: 'As confirmações para este evento estão encerradas.' });
  }

  const { name, company, role, email, phone, response } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Informe seu nome completo.' });
  }
  if (response !== 'confirmado' && response !== 'recusado') {
    return res.status(400).json({ error: 'Selecione uma opção de presença.' });
  }

  const normalized = normalizeName(name);
  const existing = db.prepare(
    'SELECT * FROM participants WHERE event_id = ? AND name_normalized = ?'
  ).get(e.id, normalized);

  const now = new Date().toISOString();

  if (existing) {
    // Atualiza registro existente (sem duplicar)
    db.prepare(`
      UPDATE participants SET name=?, company=?, role=?, email=?,
        phone=?, response=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      String(name).trim(),
      company || null,
      role || null,
      email || null,
      phone || null,
      response,
      existing.id
    );
    db.prepare(`
      INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
      VALUES (?,?,?,?,?,?,?)
    `).run(existing.id, e.id, 'atualizou', 'Participante (formulário)', existing.response, response,
      existing.response === response ? 'Dados atualizados' : `Alterou de "${existing.response}" para "${response}"`);

    return res.json({
      updated: true,
      message: 'Encontramos uma resposta anterior e seus dados foram atualizados.',
      response,
    });
  }

  // Cria novo registro
  const info = db.prepare(`
    INSERT INTO participants (event_id, name, name_normalized, company, role, email, phone, response)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(e.id, String(name).trim(), normalized, company || null, role || null, email || null, phone || null, response);

  db.prepare(`
    INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
    VALUES (?,?,?,?,?,?,?)
  `).run(info.lastInsertRowid, e.id, 'criou', 'Participante (formulário)', null, response,
    response === 'confirmado' ? 'Confirmou presença' : 'Informou que não comparecerá');

  res.status(201).json({
    updated: false,
    message: response === 'confirmado' ? e.confirm_message : e.decline_message,
    response,
  });
});

module.exports = router;
