'use strict';
// Lixeira (soft-delete) do Moura RSVP — utilidades compartilhadas.
//
// Itens excluídos (eventos, convidados e usuários) não são apagados na hora:
// recebem uma marca `deleted_at` e ficam guardados por RETENTION_DAYS dias.
// Depois desse prazo, um robô diário (scheduleTrashCleanup) apaga-os de vez,
// junto dos arquivos físicos e dos registros relacionados.
//
// Multi-tenant: o robô percorre TODAS as organizações (cada uma com seu banco).
// As funções de exclusão definitiva recebem um handle de banco explícito (`db`)
// para funcionarem tanto dentro de uma requisição (via proxy/ALS) quanto no
// robô, que roda fora de qualquer requisição.

const path = require('path');
const fs   = require('fs');
const { openTenantDb } = require('../db');
const { listOrganizations, unregisterEventSlug, unregisterAdminEmail } = require('../router');

// Quantos dias um item fica na lixeira antes da remoção definitiva (igual ao
// Moura One e ao Moura Expositor).
const RETENTION_DAYS = 90;

const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Remove um arquivo enviado (capa/logo do evento) do disco, se existir.
function removeUpload(publicPath) {
  if (!publicPath) return;
  try {
    const abs = path.join(UPLOAD_DIR, path.basename(publicPath));
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* ignora */ }
}

// ── Exclusão DEFINITIVA (irreversível) ────────────────────────────────────────
// Apaga de verdade. Usadas tanto na "exclusão permanente" manual quanto no robô.

function hardDeleteEvent(db, id) {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!e) return false;
  removeUpload(e.cover_image);
  removeUpload(e.client_logo);
  db.prepare('DELETE FROM event_access WHERE event_id = ?').run(id);
  // FOREIGN KEY ON DELETE CASCADE remove participantes e audit_log do evento.
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  // Libera o slug no índice global de roteamento (link público).
  try { unregisterEventSlug(e.slug); } catch { /* ignora */ }
  return true;
}

function hardDeleteParticipant(db, id) {
  // CASCADE remove o audit_log do participante.
  const info = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  return info.changes > 0;
}

function hardDeleteAdmin(db, id) {
  const u = db.prepare('SELECT email FROM admins WHERE id = ?').get(id);
  if (!u) return false;
  db.prepare('DELETE FROM event_access WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  try { unregisterAdminEmail(u.email); } catch { /* ignora */ }
  return true;
}

// ── Limpeza por vencimento (de um banco/tenant) ───────────────────────────────
// Apaga definitivamente tudo que está na lixeira há mais de RETENTION_DAYS dias.
function purgeExpiredTrash(db) {
  const cutoff = `datetime('now', '-${RETENTION_DAYS} days')`;
  const out = { events: 0, participants: 0, admins: 0 };

  for (const r of db.prepare(`SELECT id FROM events WHERE deleted_at IS NOT NULL AND deleted_at <= ${cutoff}`).all()) {
    if (hardDeleteEvent(db, r.id)) out.events++;
  }
  for (const r of db.prepare(`SELECT id FROM participants WHERE deleted_at IS NOT NULL AND deleted_at <= ${cutoff}`).all()) {
    if (hardDeleteParticipant(db, r.id)) out.participants++;
  }
  for (const r of db.prepare(`SELECT id FROM admins WHERE deleted_at IS NOT NULL AND deleted_at <= ${cutoff}`).all()) {
    if (hardDeleteAdmin(db, r.id)) out.admins++;
  }
  return out;
}

// Percorre TODAS as organizações e limpa a lixeira vencida de cada uma.
function purgeAllTenants() {
  const totals = { events: 0, participants: 0, admins: 0 };
  let orgs = [];
  try { orgs = listOrganizations(); } catch { orgs = []; }
  for (const org of orgs) {
    try {
      const db = openTenantDb(org.slug);
      const r  = purgeExpiredTrash(db);
      totals.events += r.events; totals.participants += r.participants; totals.admins += r.admins;
    } catch (e) {
      console.error(`[trash] erro ao limpar a organização "${org.slug}":`, e.message);
    }
  }
  return totals;
}

// Agenda o robô diário: roda 2 min após o boot e depois a cada 24 h.
function scheduleTrashCleanup() {
  const run = () => {
    try {
      const t = purgeAllTenants();
      if (t.events || t.participants || t.admins) {
        console.log(`[trash] limpeza automática: ${t.events} evento(s), ${t.participants} convidado(s) e ${t.admins} usuário(s) removido(s) definitivamente`);
      }
    } catch (e) {
      console.error('[trash] erro na limpeza automática:', e.message);
    }
  };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, 24 * 60 * 60 * 1000);
  console.log('[trash] limpeza automática ativa: itens na lixeira há mais de 90 dias são apagados (robô diário).');
}

module.exports = {
  RETENTION_DAYS,
  hardDeleteEvent,
  hardDeleteParticipant,
  hardDeleteAdmin,
  purgeExpiredTrash,
  purgeAllTenants,
  scheduleTrashCleanup,
};
