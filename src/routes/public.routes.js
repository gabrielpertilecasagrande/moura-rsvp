'use strict';
// Rotas públicas (sem autenticação) — usadas pela página /rsvp/:slug
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { findTenantBySlug } = require('../router');
const { runWithDb } = require('../db');
const { normalizeName }  = require('../utils/normalize');
const { genQrToken } = require('../utils/qrToken');
const { parseFormConfig, customFields, sanitizeAnswer, isFilled } = require('../utils/formConfig');
const { encrypt } = require('../utils/crypto');

const router = express.Router();

// Config pública para a página de privacidade (/legal.html): base da Central de
// Privacidade do Moura One (se configurada) e e-mail do canal LGPD.
router.get('/legal-config', async (_req, res) => {
  res.json({
    base: (process.env.LEGAL_BASE_URL || '').replace(/\/+$/, ''),
    scope: 'rsvp',
    email: process.env.LGPD_EMAIL || 'rp@mouracom.com.br',
    version: await currentConsentVersion(),
  });
});

// Config pública do app admin: URLs dos sistemas vizinhos para os atalhos de
// navegação (voltar ao Moura One, abrir o Check-in). Só URLs — nenhum segredo.
router.get('/app-config', (_req, res) => {
  res.json({
    moura_one_url: (process.env.MOURA_ONE_URL || process.env.LEGAL_BASE_URL || '').replace(/\/+$/, ''),
    checkin_url:   (process.env.CHECKIN_APP_URL || process.env.CHECKIN_URL || '').replace(/\/+$/, ''),
  });
});

// Versão de aceite vigente, definida no Moura One. O convidado preenche o
// formulário uma única vez (sem login recorrente), então usamos a versão apenas
// para CARIMBAR o consentimento na auditoria. Cache curto + timeout; se o Moura
// One estiver indisponível, segue sem carimbo de versão (não bloqueia a inscrição).
let _verCache = { value: null, at: 0 };
async function currentConsentVersion() {
  const now = Date.now();
  if (_verCache.value != null && now - _verCache.at < 60000) return _verCache.value;
  const base = (process.env.LEGAL_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${base}/api/legal/public/version`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return _verCache.value;
    const d = await r.json();
    _verCache = { value: String(d.version || '1'), at: now };
    return _verCache.value;
  } catch { return _verCache.value; }
}

// GET /api/public/qr/:token.png — imagem do QR de entrada do convidado.
// O conteúdo do QR é o próprio token (lido pelo app de check-in em
// /api/checkin/lookup?qr=<token>). Não exige login nem contexto de tenant:
// é apenas a renderização visual de um código aleatório (hex), seguro de expor.
router.get('/qr/:token', async (req, res) => {
  const token = String(req.params.token || '').replace(/\.png$/i, '').replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
  if (token.length < 8) return res.status(400).json({ error: 'Código inválido.' });
  try {
    const png = await QRCode.toBuffer(token, { type: 'png', width: 360, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch {
    res.status(500).json({ error: 'Falha ao gerar o QR Code.' });
  }
});

function collectExtra(cfg, rawExtra) {
  const out = {};
  const src = (rawExtra && typeof rawExtra === 'object') ? rawExtra : {};
  for (const f of customFields(cfg)) {
    const val = sanitizeAnswer(f, src[f.key]);
    if (val != null) out[f.key] = val;
  }
  return out;
}

function deadlinePassed(deadline) {
  if (!deadline) return false;
  // Fim do dia no horário do Brasil (UTC-3, sem horário de verão atualmente).
  // Sem o fuso explícito, o prazo era interpretado em UTC e encerrava ~3h cedo.
  return Date.now() > new Date(`${deadline}T23:59:59-03:00`).getTime();
}

function isClosed(e) {
  if (e.status !== 'ativo') return true;
  if (e.force_open) return false;
  return deadlinePassed(e.rsvp_deadline);
}

function personalize(msg, name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return String(msg || '').replace(/\{nome\}|\{primeiro_nome\}/gi, first);
}

// Localiza participante existente APENAS por identificador forte (e-mail ou
// telefone). O nome sozinho NÃO é chave segura: como o formulário é público,
// qualquer pessoa que soubesse o nome de um convidado poderia sobrescrever a
// resposta dele. A colisão por nome (homônimos) é tratada no handler.
function findByContact(eventId, { email, phone }) {
  if (email && email.trim()) {
    const r = db.prepare('SELECT * FROM participants WHERE event_id = ? AND lower(email) = lower(?)').get(eventId, email.trim());
    if (r) return r;
  }
  if (phone && String(phone).replace(/\D/g, '')) {
    const digits = String(phone).replace(/\D/g, '');
    const r = db.prepare("SELECT * FROM participants WHERE event_id = ? AND replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')','') = ?").get(eventId, digits);
    if (r) return r;
  }
  return null;
}

// Resolve o tenant a partir do slug e executa fn() no contexto do banco correto.
function withTenantForSlug(slug, res, fn) {
  const ref = findTenantBySlug(slug);
  if (!ref) return res.status(404).json({ error: 'Evento não encontrado.' });
  runWithDb(ref.tenant_slug, fn);
}

function parseLandingConfig(raw) {
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!p || typeof p !== 'object') return { sections: [] };
    if (!Array.isArray(p.sections)) p.sections = [];
    return p;
  } catch { return { sections: [] }; }
}

// GET /api/public/events/:slug  — dados públicos do evento
router.get('/events/:slug', (req, res) => {
  withTenantForSlug(req.params.slug, res, () => {
    const e = db.prepare('SELECT * FROM events WHERE slug = ? AND deleted_at IS NULL').get(req.params.slug);
    if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });
    const closed = isClosed(e);
    res.json({
      slug:            e.slug,
      name:            e.name,
      description:     e.description,
      event_date:      e.event_date,
      event_time:      e.event_time,
      location:        e.location,
      city:            e.city,
      address:         e.address,
      cover_image:     e.cover_image,
      client_logo:     e.client_logo,
      rsvp_deadline:   e.rsvp_deadline,
      whatsapp:        e.whatsapp_enabled ? (e.whatsapp || null) : null,
      form_config:     parseFormConfig(e.form_config),
      landing_enabled: e.landing_enabled ? 1 : 0,
      landing_config:  parseLandingConfig(e.landing_config),
      closed,
      closed_reason:   e.status !== 'ativo' ? 'inativo' : (closed ? 'prazo' : null),
    });
  });
});

// POST /api/public/events/:slug/rsvp  — registra ou atualiza resposta
router.post('/events/:slug/rsvp', (req, res) => {
  withTenantForSlug(req.params.slug, res, async () => {
    const e = db.prepare('SELECT * FROM events WHERE slug = ? AND deleted_at IS NULL').get(req.params.slug);
    if (!e) return res.status(404).json({ error: 'Evento não encontrado.' });

    if (isClosed(e)) {
      return res.status(403).json({ error: 'As confirmações para este evento estão encerradas.' });
    }

    // Honeypot: campo invisível para humanos; se preenchido, é bot.
    if (req.body && req.body.website) {
      return res.status(201).json({ updated: false, message: 'Resposta registrada.', response: req.body.response || 'confirmado' });
    }

    const { name, company, role, email, phone, response } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Informe seu nome.' });
    }
    // Exige um nome com sentido (ao menos 2 letras), sem obrigar sobrenome —
    // nomes de uma palavra/estrangeiros são legítimos e não devem ser barrados.
    if (String(name).replace(/[^\p{L}]/gu, '').length < 2) {
      return res.status(400).json({ error: 'Por favor, informe seu nome.' });
    }
    if (response !== 'confirmado' && response !== 'recusado') {
      return res.status(400).json({ error: 'Selecione uma opção de presença.' });
    }

    // LGPD — consentimento obrigatório (Termos + Privacidade + tratamento de dados).
    const aceitaTermos   = req.body.accepted_terms === true || req.body.accepted_terms === 1 || req.body.accepted_terms === '1';
    const aceitaPriv     = req.body.accepted_privacy_policy === true || req.body.accepted_privacy_policy === 1 || req.body.accepted_privacy_policy === '1';
    const aceitaDados    = req.body.accepted_data_processing === true || req.body.accepted_data_processing === 1 || req.body.accepted_data_processing === '1';
    if (!aceitaTermos || !aceitaPriv || !aceitaDados) {
      return res.status(400).json({ error: 'É necessário aceitar os Termos, a Política de Privacidade e autorizar o tratamento dos dados.' });
    }
    const consentIp      = req.ip || null;
    // Carimba a versão de aceite vigente (do Moura One) quando o cliente não a envia.
    const curVer         = await currentConsentVersion();
    const termsVersion   = req.body.terms_version ? String(req.body.terms_version).slice(0, 40) : curVer;
    const privacyVersion = req.body.privacy_version ? String(req.body.privacy_version).slice(0, 40) : curVer;

    const cfg = parseFormConfig(e.form_config);
    const builtinVal = { company, role, email, phone };
    const extra = collectExtra(cfg, req.body.extra);
    for (const f of cfg.fields) {
      if (!f.enabled || !f.required) continue;
      const filled = f.builtin ? isFilled(builtinVal[f.key]) : isFilled(extra[f.key]);
      if (!filled) return res.status(400).json({ error: `O campo "${f.label}" é obrigatório.` });
    }
    const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : null;

    const normalized = normalizeName(name);

    // Aplica UPDATE em um registro existente (correção da própria resposta).
    const doUpdate = (target) => {
      // Gera o código de entrada (QR) na primeira confirmação; preserva o já
      // existente para não invalidar um QR já apresentado ao convidado.
      const qrToken = response === 'confirmado'
        ? (target.qr_token || genQrToken())
        : (target.qr_token || null);

      db.prepare(`
        UPDATE participants SET name=?, company=?, role=?, email=?,
          phone=?, response=?, name_normalized=?, extra=?, qr_token=?,
          accepted_terms=1, accepted_privacy_policy=1, accepted_data_processing=1,
          consent_date=datetime('now'), consent_ip=?, terms_version=?, privacy_version=?,
          deleted_at=NULL, deleted_by=NULL, updated_at=datetime('now')
        WHERE id=?
      `).run(String(name).trim(), encrypt(company || null), encrypt(role || null), email || null,
             phone || null, response, normalized, extraJson, qrToken,
             consentIp, termsVersion, privacyVersion, target.id);

      db.prepare(`
        INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
        VALUES (?,?,?,?,?,?,?)
      `).run(target.id, e.id, 'atualizou', 'Participante (formulário)', target.response, response,
        target.response === response ? 'Dados atualizados' : `Alterou de "${target.response}" para "${response}"`);

      return res.json({
        updated: true,
        message: personalize(response === 'confirmado' ? e.confirm_message : e.decline_message, name),
        response,
        qr_token: response === 'confirmado' ? qrToken : null,
      });
    };

    // Casa apenas por e-mail/telefone (identificador forte). Se casar, é a própria
    // pessoa corrigindo a resposta.
    const existing = findByContact(e.id, { email, phone });
    if (existing) return doUpdate(existing);

    // Sem correspondência por contato → novo registro. Pode colidir com o índice
    // único (event_id, name_normalized) se já houver alguém com o mesmo nome.
    try {
      const qrToken = response === 'confirmado' ? genQrToken() : null;
      const info = db.prepare(`
        INSERT INTO participants (event_id, name, name_normalized, company, role, email, phone, response, extra, qr_token,
          accepted_terms, accepted_privacy_policy, accepted_data_processing, consent_date, consent_ip, terms_version, privacy_version)
        VALUES (?,?,?,?,?,?,?,?,?,?, 1, 1, 1, datetime('now'), ?, ?, ?)
      `).run(e.id, String(name).trim(), normalized, encrypt(company || null), encrypt(role || null),
             email || null, phone || null, response, extraJson, qrToken,
             consentIp, termsVersion, privacyVersion);

      db.prepare(`
        INSERT INTO audit_log (participant_id, event_id, action, actor, old_response, new_response, details)
        VALUES (?,?,?,?,?,?,?)
      `).run(info.lastInsertRowid, e.id, 'criou', 'Participante (formulário)', null, response,
        response === 'confirmado' ? 'Confirmou presença' : 'Informou que não comparecerá');

      return res.status(201).json({
        updated: false,
        message: personalize(response === 'confirmado' ? e.confirm_message : e.decline_message, name),
        response,
        qr_token: qrToken,
      });
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
      // Já existe alguém com este nome neste evento (e não casou por contato).
      const sameName = db.prepare('SELECT * FROM participants WHERE event_id = ? AND name_normalized = ?').get(e.id, normalized);
      // Registro com este nome estava na lixeira → reinscrição o traz de volta.
      if (sameName && sameName.deleted_at) return doUpdate(sameName);
      // Mesma pessoa anônima reenviando (nenhum dos dois lados tem contato) → atualiza.
      if (sameName && !sameName.email && !sameName.phone && !email && !phone) return doUpdate(sameName);
      // Pessoas diferentes com o mesmo nome → NÃO sobrescreve ninguém.
      // (O índice único por nome impede dois registros homônimos no mesmo evento.)
      return res.status(409).json({
        error: 'Já existe uma confirmação com este nome neste evento. Se foi você que já confirmou, reenvie usando o mesmo e-mail ou telefone do cadastro. Se você é outra pessoa com o mesmo nome, fale com a organização para registrar sua presença.',
      });
    }
  });
});

module.exports = router;
