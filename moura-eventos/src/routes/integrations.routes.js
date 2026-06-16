const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(requireAuth);

const RSVP_API_URL   = () => (process.env.RSVP_API_URL   || '').replace(/\/$/, '');
const CHECKIN_URL    = () => (process.env.CHECKIN_URL     || '').replace(/\/$/, '');
const RSVP_SECRET    = () => process.env.RSVP_JWT_SECRET;
const SUPABASE_URL   = () => (process.env.SUPABASE_URL    || '').replace(/\/$/, '');
const SUPABASE_KEY   = () => process.env.SUPABASE_SERVICE_KEY;

// ── POST /api/integrations/sso-token ────────────────────────────────────────
// Gera um JWT temporário para login automático no RSVP.
router.post('/sso-token', async (req, res) => {
  const secret = RSVP_SECRET();
  if (!secret)  return res.status(503).json({ error: 'RSVP_JWT_SECRET não configurado.' });
  const rsvpUrl = RSVP_API_URL();
  if (!rsvpUrl) return res.status(503).json({ error: 'RSVP_API_URL não configurado.' });

  const { target = 'rsvp', event_id } = req.body || {};
  if (target !== 'rsvp') return res.status(400).json({ error: 'Target inválido.' });

  const user = req.admin;
  const token = jwt.sign(
    { email: user.email, target: 'rsvp' },
    secret,
    { expiresIn: '5m' }
  );

  // Busca o rsvp_event_id vinculado ao evento (se event_id fornecido).
  let rsvpEventId = null;
  if (event_id) {
    const ev = db.prepare('SELECT rsvp_event_id FROM events WHERE id = ?').get(Number(event_id));
    rsvpEventId = ev?.rsvp_event_id || null;
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sso_tokens (token, target, user_id, event_id, expires_at) VALUES (?,?,?,?,?)'
  ).run(token, 'rsvp', user.id, event_id ? Number(event_id) : null, expiresAt);

  const params = new URLSearchParams({ token });
  if (rsvpEventId) params.set('event', rsvpEventId);
  const url = `${rsvpUrl}/api/auth/sso?${params.toString()}`;

  logActivity(user.name || user.email, 'gerou token SSO', `target=rsvp event_id=${event_id || '—'}`);
  res.json({ url });
});

// ── POST /api/integrations/operator-token ───────────────────────────────────
// Gera token de operador para o Check-in, inserido no Supabase via REST.
router.post('/operator-token', async (req, res) => {
  const supUrl = SUPABASE_URL();
  const supKey = SUPABASE_KEY();
  const ciUrl  = CHECKIN_URL();
  if (!supUrl || !supKey) return res.status(503).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.' });

  const { checkin_event_id, label, expires_hours = 12 } = req.body || {};
  if (!checkin_event_id) return res.status(400).json({ error: 'Informe checkin_event_id.' });

  const token    = uuidv4();
  const expiresAt = new Date(Date.now() + Number(expires_hours) * 60 * 60 * 1000).toISOString();

  // Insere no Supabase (tabela operator_tokens no banco do Check-in).
  const resp = await fetch(`${supUrl}/rest/v1/operator_tokens`, {
    method: 'POST',
    headers: {
      'apikey':        supKey,
      'Authorization': `Bearer ${supKey}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({ token, checkin_event_id, label: label || null, expires_at: expiresAt }),
  }).catch(() => null);

  if (!resp || !resp.ok) {
    const txt = resp ? await resp.text().catch(() => '') : 'network error';
    return res.status(502).json({ error: 'Erro ao inserir token no Supabase.', detail: txt });
  }

  // Salva também localmente para rastreamento.
  db.prepare(
    'INSERT INTO operator_tokens (token, checkin_event_id, label, expires_at, created_by) VALUES (?,?,?,?,?)'
  ).run(token, checkin_event_id, label || null, expiresAt, req.admin.id);

  const url = ciUrl ? `${ciUrl}?token=${encodeURIComponent(token)}` : null;
  logActivity(req.admin.name || req.admin.email, 'gerou token de operador', `checkin_event=${checkin_event_id}`);
  res.status(201).json({ token, url, expires_at: expiresAt });
});

// ── GET /api/integrations/rsvp-metrics/:rsvpEventId ─────────────────────────
router.get('/rsvp-metrics/:rsvpEventId', async (req, res) => {
  const rsvpUrl = RSVP_API_URL();
  if (!rsvpUrl) return res.status(503).json({ error: 'RSVP_API_URL não configurado.' });
  const secret  = RSVP_SECRET();
  if (!secret)  return res.status(503).json({ error: 'RSVP_JWT_SECRET não configurado.' });

  // Usa um token de serviço de curta duração para autenticar no RSVP.
  const svcToken = jwt.sign({ email: req.admin.email, target: 'rsvp' }, secret, { expiresIn: '1m' });

  try {
    const resp = await fetch(
      `${rsvpUrl}/api/events/${encodeURIComponent(req.params.rsvpEventId)}/metrics`,
      { headers: { Authorization: `Bearer ${svcToken}` } }
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: data.error || 'Erro ao buscar métricas do RSVP.' });
    }
    res.json(await resp.json());
  } catch {
    res.status(502).json({ error: 'Não foi possível conectar ao RSVP.' });
  }
});

// ── GET /api/integrations/checkin-metrics/:checkinEventId ───────────────────
router.get('/checkin-metrics/:checkinEventId', async (req, res) => {
  const supUrl = SUPABASE_URL();
  const supKey = SUPABASE_KEY();
  if (!supUrl || !supKey) return res.status(503).json({ error: 'Supabase não configurado.' });

  const eid = req.params.checkinEventId;
  try {
    // Conta check-ins confirmados na tabela `checkins` do Supabase.
    const resp = await fetch(
      `${supUrl}/rest/v1/checkins?event_id=eq.${encodeURIComponent(eid)}&select=id`,
      {
        headers: {
          'apikey':        supKey,
          'Authorization': `Bearer ${supKey}`,
          'Prefer':        'count=exact',
          'Range':         '0-0',
        },
      }
    );
    const total = Number(resp.headers.get('content-range')?.split('/')[1] ?? 0);
    res.json({ total_checkins: total, event_id: eid });
  } catch {
    res.status(502).json({ error: 'Não foi possível conectar ao Supabase.' });
  }
});

module.exports = router;
