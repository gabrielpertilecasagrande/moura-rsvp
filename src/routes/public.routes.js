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
  let parsed = {};
  try { parsed = JSON.parse(raw || '{}') || {}; } catch { parsed = {}; }
  const out = {};
  for (const k of Object.keys(DEFAULT_FORM_CONFIG)) {
    out[k] = { ...DEFAULT_FORM_CONFIG[k], ...(parsed[k] || {}) };
    if (!out[k].label) out[k].label = DEFAULT_FORM_CONFIG[k].label;
  }
  return out;
};

function deadlinePassed(deadline) {
  if (!deadline) return false;
  // compara apenas a data (fim do dia da data limite)
  const end = new Date(`${deadline}T23:59:59`);
  return Date.now() > end.getTime();
}

// Um evento está fechado se estiver inativo, OU se o prazo passou E não foi reaberto.
function isClosed(e) {
  if (e.status !== 'ativo') return true;
  if (e.force_open) return false;
  return deadlinePassed(e.rsvp_deadline);
}

// Substitui {nome} / {primeiro_nome} pelo primeiro nome do participante.
function personalize(msg, name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return String(msg || '').replace(/\{nome\}|\{primeiro_nome\}/gi, first);
}

// Localiza participante já existente por prioridade: e-mail > telefone > nome.
function findExisting(eventId, { email, phone, normalized }) {
  if (email && email.trim()) {
    const byEmail = db.prepare('SELECT * FROM participants WHERE event_id = ? AND lower(email) = lower(?)').get(eventId, email.trim());
    if (byEmail) return byEmail;
  }
  if (phone && String(phone).replace(/\D/g, '')) {
    const digits = String(phone).replace(/\D/g, '');
    const byPhone = db.prepare("SELECT * FROM participants WHERE event_id = ? AND replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','') = ?").get(eventId, digits);
    if (byPhone) return byPhone;
  }
  return db.prepare('SELECT * FROM participants WHERE event_id = ? AND name_normalized = ?').get(eventId, normalized);
}

// GET /api/public/events/:slug  — dados públicos do evento
router.get('/events/:slug', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  const closed = isClosed(e);
  res.json({
    slug: e.slug,
    name: e.name,
    description: e.description,
    event_date: e.event_date,
    event_time: e.event_time,
    location: e.location,
    city: e.city,
    address: e.address,
    cover_image: e.cover_image,
    client_logo: e.client_logo,
    rsvp_deadline: e.rsvp_deadline,
    whatsapp: e.whatsapp_enabled ? (e.whatsapp || null) : null,
    form_config: parseFormConfig(e.form_config),
    closed,
    closed_reason: e.status !== 'ativo' ? 'inativo' : (closed ? 'prazo' : null),
  });
});

// POST /api/public/events/:slug/rsvp  — registra ou atualiza resposta
router.post('/events/:slug/rsvp', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE slug = ?').get(req.params.slug);
  if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

  if (isClosed(e)) {
    return res.status(403).json({ error: 'As confirmações para este evento estão encerradas.' });
  }

  // Armadilha anti-bot (honeypot): o campo "website" é invisível para humanos.
  // Se vier preenchido, é um robô — fingimos sucesso e não gravamos nada.
  if (req.body && req.body.website) {
    return res.status(201).json({ updated: false, message: 'Resposta registrada.', response: req.body.response || 'confirmado' });
  }

  const { name, company, role, email, phone, response } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Informe seu nome completo.' });
  }
  // Exige nome + sobrenome (ao menos duas palavras com 2+ letras).
  const parts = String(name).trim().split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 2);
  if (parts.length < 2) {
    return res.status(400).json({ error: 'Por favor, informe seu nome completo (nome e sobrenome).' });
  }
  if (response !== 'confirmado' && response !== 'recusado') {
    return res.status(400).json({ error: 'Selecione uma opção de presença.' });
  }

  const normalized = normalizeName(name);
  const existing = findExisting(e.id, { email, phone, normalized });

  if (existing) {
    // Atualiza registro existente (sem duplicar)
    db.prepare(`
      UPDATE participants SET name=?, company=?, role=?, email=?,
        phone=?, response=?, name_normalized=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      String(name).trim(),
      company || null,
      role || null,
      email || null,
      phone || null,
      response,
      normalized,
      existing.id
    );
    db.prepare(`
      INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
      VALUES (?,?,?,?,?,?,?)
    `).run(existing.id, e.id, 'atualizou', 'Participante (formulário)', existing.response, response,
      existing.response === response ? 'Dados atualizados' : `Alterou de "${existing.response}" para "${response}"`);

    return res.json({
      updated: true,
      message: personalize(response === 'confirmado' ? e.confirm_message : e.decline_message, name),
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
    message: personalize(response === 'confirmado' ? e.confirm_message : e.decline_message, name),
    response,
  });
});

module.exports = router;
