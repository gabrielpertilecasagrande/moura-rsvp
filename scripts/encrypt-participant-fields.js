#!/usr/bin/env node
// Migração única: cifra company + role nos participantes de todos os tenants.
// Execute APÓS definir DATA_ENCRYPTION_KEY no ambiente.
// É idempotente: registros já cifrados (prefixo "enc:") são ignorados.
//
// Uso:
//   DATA_ENCRYPTION_KEY=<64-hex> node scripts/encrypt-participant-fields.js
'use strict';
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');
const { encrypt } = require('../src/utils/crypto');

if (!process.env.DATA_ENCRYPTION_KEY) {
  console.error('[migração] DATA_ENCRYPTION_KEY não está definido. Defina a variável antes de rodar.');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const tenantsDir = path.join(DATA_DIR, 'tenants');
if (!fs.existsSync(tenantsDir)) {
  console.log('[migração] Diretório de tenants não encontrado:', tenantsDir);
  process.exit(0);
}

let totalUpdated = 0;
for (const slug of fs.readdirSync(tenantsDir)) {
  const dbPath = path.join(tenantsDir, slug, 'rsvp.db');
  if (!fs.existsSync(dbPath)) continue;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const rows = db.prepare('SELECT id, company, role FROM participants').all();
  const upd  = db.prepare('UPDATE participants SET company=?, role=? WHERE id=?');
  let count  = 0;

  db.transaction(() => {
    for (const r of rows) {
      const newCompany = (r.company && !String(r.company).startsWith('enc:')) ? encrypt(r.company) : r.company;
      const newRole    = (r.role    && !String(r.role).startsWith('enc:'))    ? encrypt(r.role)    : r.role;
      if (newCompany !== r.company || newRole !== r.role) {
        upd.run(newCompany, newRole, r.id);
        count++;
      }
    }
  })();

  db.close();
  console.log(`[migração] tenant ${slug}: ${count} participante(s) cifrado(s) de ${rows.length}`);
  totalUpdated += count;
}

console.log(`[migração] Concluído. Total: ${totalUpdated} participante(s) com campos cifrados.`);
