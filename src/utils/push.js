// Notificações push (Web Push) para o RSVP.
//
// Chaves VAPID (identidade do servidor) são compartilhadas entre tenants e
// armazenadas globalmente em DATA_DIR/vapid-settings.json (não no banco do tenant).
// As inscrições e o histórico de push ficam no banco do tenant (via proxy db).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');

let webpush = null;
try { webpush = require('web-push'); } catch { webpush = null; }

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../../data');

const SETTINGS_FILE = path.join(DATA_DIR, 'vapid-settings.json');

function readGlobalSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch { return {}; }
}

function writeGlobalSettings(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.error('[push] falha ao salvar settings:', e.message); }
}

function getSetting(key) {
  return readGlobalSettings()[key] || null;
}

function setSetting(key, value) {
  const s = readGlobalSettings();
  s[key] = value;
  writeGlobalSettings(s);
}

let cachedKeys = null;

function getVapidKeys() {
  if (cachedKeys) return cachedKeys;
  let pub  = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    pub  = getSetting('vapid_public_key');
    priv = getSetting('vapid_private_key');
  }
  if ((!pub || !priv) && webpush) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    setSetting('vapid_public_key', pub);
    setSetting('vapid_private_key', priv);
    console.log('[push] Chaves VAPID geradas e salvas automaticamente.');
  }
  if (!pub || !priv) return null;
  cachedKeys = { publicKey: pub, privateKey: priv };
  return cachedKeys;
}

function vapidSubject() {
  const s = (process.env.VAPID_SUBJECT || '').trim();
  if (s) return s;
  return 'mailto:contato@mouraone.app';
}

function applyVapid() {
  if (!webpush) return false;
  const keys = getVapidKeys();
  if (!keys) return false;
  try {
    webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
    return true;
  } catch (e) {
    console.error('[push] VAPID inválido:', e.message);
    return false;
  }
}

function configured() {
  return !!(webpush && getVapidKeys());
}

function publicKey() {
  const k = getVapidKeys();
  return k ? k.publicKey : null;
}

function saveSubscription(userId, sub, userAgent) {
  if (!sub || !sub.endpoint) return false;
  const keys = sub.keys || {};
  const p256dh = keys.p256dh || '';
  const auth   = keys.auth || '';
  if (!p256dh || !auth) return false;
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint);
  if (existing) {
    db.prepare(
      "UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, last_used_at = datetime('now') WHERE endpoint = ?"
    ).run(userId, p256dh, auth, userAgent || '', sub.endpoint);
  } else {
    db.prepare(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).run(userId, sub.endpoint, p256dh, auth, userAgent || '');
  }
  return true;
}

function removeSubscription(endpoint) {
  if (!endpoint) return;
  try { db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint); }
  catch (e) { console.error('[push] falha ao remover inscrição:', e.message); }
}

async function sendToSubs(subs, payload) {
  if (!applyVapid() || !subs.length) return { sent: 0, removed: 0, recipients: {} };
  const body = JSON.stringify(payload);
  let sent = 0, removed = 0;
  const recipients = {};
  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, body);
      sent++;
      recipients[s.user_id] = (recipients[s.user_id] || 0) + 1;
      db.prepare("UPDATE push_subscriptions SET last_used_at = datetime('now') WHERE id = ?").run(s.id);
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        removed++;
      } else {
        console.error('[push] falha ao enviar:', e && (e.statusCode || e.message));
      }
    }
  }
  return { sent, removed, recipients };
}

async function sendToUser(userId, payload) {
  if (!configured()) return { sent: 0, removed: 0, recipients: {} };
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  return sendToSubs(subs, payload);
}

async function sendToUsers(userIds, payload) {
  if (!configured() || !userIds || !userIds.length) return { sent: 0, removed: 0, devices: 0, recipients: {} };
  const ph = userIds.map(() => '?').join(',');
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${ph})`).all(...userIds);
  const r = await sendToSubs(subs, payload);
  return { ...r, devices: subs.length };
}

async function sendToAll(payload) {
  if (!configured()) return { sent: 0, removed: 0, devices: 0, recipients: {} };
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  const r = await sendToSubs(subs, payload);
  return { ...r, devices: subs.length };
}

function stats() {
  let totalDevices = 0, totalUsers = 0;
  try {
    totalDevices = db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;
    totalUsers   = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM push_subscriptions').get().n;
  } catch { /* tabela pode não existir ainda */ }
  return { configured: configured(), totalDevices, totalUsers };
}

function subscribersByUser() {
  try {
    return db.prepare(`
      SELECT a.id, a.name, a.email, a.role, COUNT(p.id) AS devices,
             MAX(p.last_used_at) AS last_used_at
      FROM admins a
      JOIN push_subscriptions p ON p.user_id = a.id
      WHERE (a.deleted_at IS NULL)
      GROUP BY a.id
      ORDER BY a.name
    `).all();
  } catch { return []; }
}

function logPush({ actorId, actorName, ip, title, body, url, target, targetIds, sentCount, devicesCount, recipients }) {
  try {
    let recipientsJson = null;
    if (recipients && Object.keys(recipients).length) {
      const ids = Object.keys(recipients).map(Number).filter(Boolean);
      if (ids.length) {
        const rows = db.prepare(
          `SELECT id, name, email FROM admins WHERE id IN (${ids.map(() => '?').join(',')})`
        ).all(...ids);
        const nameById = Object.fromEntries(rows.map((r) => [r.id, r.name || r.email]));
        const list = ids.map((id) => ({ id, name: nameById[id] || `Usuário #${id}`, devices: recipients[id] }));
        recipientsJson = JSON.stringify(list);
      }
    }
    db.prepare(
      `INSERT INTO push_log (actor_id, actor_name, ip, title, body, url, target, target_ids, sent_count, devices_count, recipients)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actorId || null, actorName || 'Sistema', ip || null,
      title, body, url || null, target,
      targetIds ? JSON.stringify(targetIds) : null,
      sentCount || 0, devicesCount || 0, recipientsJson,
    );
  } catch (e) { console.error('[push] falha ao gravar log:', e.message); }
}

// Inicializa no boot (gera/aplica chaves). Não usa o db proxy (sem contexto de tenant).
function init() {
  if (!webpush) {
    console.log('[push] dependência web-push ausente — notificações push desativadas.');
    return;
  }
  if (applyVapid()) {
    console.log('[push] pronto.');
  } else {
    console.log('[push] não foi possível obter chaves VAPID.');
  }
}

module.exports = {
  configured, publicKey, saveSubscription, removeSubscription,
  sendToUser, sendToUsers, sendToAll, stats, subscribersByUser,
  logPush, init,
};
