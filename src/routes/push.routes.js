const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const push = require('../utils/push');
const db = require('../db');

const router = express.Router();
router.use(requireAuth);

router.get('/vapid-public-key', (_req, res) => {
  const key = push.publicKey();
  if (!key) return res.status(503).json({ error: 'Notificações push não estão disponíveis no servidor.' });
  res.json({ publicKey: key });
});

router.post('/subscribe', (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Inscrição inválida.' });
  }
  const ok = push.saveSubscription(req.admin.id, subscription, req.headers['user-agent']);
  if (!ok) return res.status(400).json({ error: 'Inscrição incompleta.' });
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) push.removeSubscription(endpoint);
  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  try {
    const testTitle = '🔔 Moura RSVP';
    const testBody  = 'Notificações ativadas! Você vai receber os avisos importantes por aqui.';
    const result = await push.sendToUser(req.admin.id, {
      title: testTitle,
      body: testBody,
      url: '/admin/dashboard.html',
      tag: 'moura-test',
    });
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
    push.logPush({
      actorId: req.admin.id,
      actorName: req.admin.name || req.admin.email,
      ip,
      title: testTitle,
      body: testBody,
      url: '/admin/dashboard.html',
      target: 'test',
      targetIds: [req.admin.id],
      sentCount: result.sent || 0,
      devicesCount: result.sent || 0,
      recipients: result.recipients,
    });
    if (!result.sent) {
      return res.status(503).json({ error: 'Nenhum aparelho recebeu. Verifique a permissão de notificações do navegador.' });
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/overview', requireAdmin, (_req, res) => {
  res.json({ ...push.stats(), subscribers: push.subscribersByUser() });
});

router.post('/admin/send', requireAdmin, async (req, res) => {
  const { title, body, url, target, userIds } = req.body || {};
  const t = (title || '').trim();
  const b = (body || '').trim();
  if (!t) return res.status(400).json({ error: 'Informe um título para o aviso.' });
  if (!b) return res.status(400).json({ error: 'Informe a mensagem do aviso.' });
  const finalUrl = (url && url.trim()) || '/admin/dashboard.html';
  const payload = { title: t, body: b, url: finalUrl, tag: 'moura-manual-' + Date.now() };
  const isSelected = target === 'selected' && Array.isArray(userIds) && userIds.length;
  const cleanIds = isSelected ? userIds.map(Number).filter(Boolean) : null;
  let result;
  if (isSelected) { result = await push.sendToUsers(cleanIds, payload); }
  else { result = await push.sendToAll(payload); }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
  push.logPush({
    actorId: req.admin.id,
    actorName: req.admin.name || req.admin.email,
    ip, title: t, body: b, url: finalUrl,
    target: isSelected ? 'selected' : 'all',
    targetIds: cleanIds,
    sentCount: result.sent || 0,
    devicesCount: result.devices || 0,
    recipients: result.recipients,
  });
  if (!result.sent) {
    return res.status(200).json({ ok: true, sent: 0, devices: result.devices || 0,
      warning: 'Nenhum aparelho recebeu (ninguém inscrito no alvo escolhido ou push indisponível).' });
  }
  res.json({ ok: true, ...result });
});

const PUSH_PERIODS = {
  today: "pl.created_at >= datetime('now','start of day')",
  '7d':  "pl.created_at >= datetime('now','-7 days')",
  '30d': "pl.created_at >= datetime('now','-30 days')",
  all:   null,
};

router.get('/admin/history', requireAdmin, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const q = (req.query.q || '').trim();
  const period = Object.prototype.hasOwnProperty.call(PUSH_PERIODS, req.query.period) ? req.query.period : 'all';
  const from = (req.query.from || '').trim();
  const to   = (req.query.to || '').trim();
  const type = (req.query.type || '').trim();
  const where = [];
  const params = [];
  if (PUSH_PERIODS[period]) where.push(PUSH_PERIODS[period]);
  if (from) { where.push('pl.created_at >= ?'); params.push(from + ' 00:00:00'); }
  if (to)   { where.push('pl.created_at <= ?'); params.push(to + ' 23:59:59'); }
  if (q) {
    where.push('(pl.actor_name LIKE ? OR pl.title LIKE ? OR pl.body LIKE ? OR pl.ip LIKE ? OR pl.recipients LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (type) {
    if (type === 'auto') where.push("pl.target IN ('user','digest')");
    else { where.push('pl.target = ?'); params.push(type); }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM push_log pl ${whereSql}`).get(...params).n;
  const rows  = db.prepare(
    `SELECT pl.* FROM push_log pl ${whereSql}
     ORDER BY pl.created_at DESC, pl.id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset).map((r) => ({
    ...r,
    target_ids: r.target_ids ? JSON.parse(r.target_ids) : null,
    recipients: r.recipients ? JSON.parse(r.recipients) : null,
  }));
  res.json({ rows, total, hasMore: offset + limit < total });
});

module.exports = router;
