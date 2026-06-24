'use strict';
// Gera um backup consistente do banco de um tenant (ou de todos).
//
// Usa "VACUUM INTO", que produz uma cópia íntegra mesmo com o sistema em uso.
// Os arquivos são gravados em DATA_DIR/backups/<slug>-<timestamp>.db.
//
// Uso:
//   node scripts/backup-tenant.js --slug=moura
//   node scripts/backup-tenant.js --all
//   node scripts/backup-tenant.js --all --out=/caminho/para/backups

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

const args = process.argv.slice(2);
const getArg = (key) => {
  const match = args.find((a) => a.startsWith(`--${key}=`));
  return match ? match.split('=').slice(1).join('=') : undefined;
};
const hasFlag = (key) => args.includes(`--${key}`);

const outDir = getArg('out') ? path.resolve(getArg('out')) : path.join(DATA_DIR, 'backups');
fs.mkdirSync(outDir, { recursive: true });

function openDb(dbPath) {
  try {
    const Database = require('better-sqlite3');
    return new Database(dbPath);
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath);
  }
}

function backup(slug) {
  const dbPath = path.join(TENANTS_DIR, slug, 'rsvp.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`✗ ${slug}: rsvp.db não encontrado`);
    return false;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const rand  = Math.random().toString(36).slice(2, 6);
  const out = path.join(outDir, `${slug}-${stamp}-${rand}.db`);
  const db = openDb(dbPath);
  try {
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    // Backup contém dados pessoais: leitura só para o dono do arquivo.
    try { fs.chmodSync(out, 0o600); } catch { /* best-effort */ }
  } catch (e) {
    console.error(`✗ ${slug}: ${e.message}`);
    return false;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  const size = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`✓ ${slug} → ${out} (${size} KB)`);
  return true;
}

let slugs;
if (hasFlag('all')) {
  if (!fs.existsSync(TENANTS_DIR)) {
    console.error('Nenhum tenant encontrado em', TENANTS_DIR);
    process.exit(1);
  }
  slugs = fs.readdirSync(TENANTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} else if (getArg('slug')) {
  slugs = [getArg('slug')];
} else {
  console.error('Uso: node scripts/backup-tenant.js --slug=<slug> | --all [--out=/dir]');
  process.exit(1);
}

let ok = 0;
for (const slug of slugs) if (backup(slug)) ok++;
console.log(`\nConcluído — ${ok}/${slugs.length} backup(s) gerado(s) em ${outDir}`);
process.exit(ok === slugs.length ? 0 : 1);
