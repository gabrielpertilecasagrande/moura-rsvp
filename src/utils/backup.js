'use strict';
// Backup automático: snapshot consistente de todos os bancos SQLite (router +
// tenants) + tarball de uploads, com upload para storage S3-compatível
// (Cloudflare R2, AWS S3, etc.) e rotação local.
//
// Arquitetura multi-tenant:
//   DATA_DIR/router.db              — banco de roteamento global
//   DATA_DIR/tenants/<slug>/rsvp.db — banco de cada tenant
//   DATA_DIR/uploads/               — arquivos compartilhados
//
// Variáveis de ambiente (todas opcionais — sem elas, backup é só local):
//   S3_BUCKET            nome do bucket
//   S3_ENDPOINT          endpoint S3-compatível (R2: https://<acct>.r2.cloudflarestorage.com)
//   S3_ACCESS_KEY_ID     credencial
//   S3_SECRET_ACCESS_KEY credencial
//   S3_REGION            região (padrão "auto", ideal para R2)
//   BACKUP_PREFIX        prefixo/pasta no bucket (padrão "rsvp-backups/")
//   BACKUP_INTERVAL_HOURS  intervalo do job automático em horas (padrão 24; 0 desliga)
//   BACKUP_KEEP          quantos snapshots locais manter (padrão 7)

const path = require('path');
const fs   = require('fs');
const { execFileSync } = require('child_process');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

const backupsDir = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const KEEP   = parseInt(process.env.BACKUP_KEEP, 10) || 7;
const PREFIX = (process.env.BACKUP_PREFIX || 'rsvp-backups/').replace(/^\/+/, '');

function intervalHours() {
  const raw = process.env.BACKUP_INTERVAL_HOURS;
  if (raw == null || raw === '') return 24;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 24 : n;
}

function s3Configured() {
  return !!(process.env.S3_BUCKET && process.env.S3_ENDPOINT
    && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

function s3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Snapshot consistente de um arquivo SQLite via VACUUM INTO com conexão própria.
// Não interfere com as conexões abertas do servidor.
function snapshotDbFile(srcPath, destPath) {
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  const Database = require('better-sqlite3');
  const src = new Database(srcPath, { readonly: true });
  try {
    src.prepare('VACUUM INTO ?').run(destPath);
  } finally {
    src.close();
  }
}

// Lista todos os bancos de tenant existentes.
function listTenantDbs() {
  const tenantsDir = path.join(DATA_DIR, 'tenants');
  if (!fs.existsSync(tenantsDir)) return [];
  return fs.readdirSync(tenantsDir)
    .map((slug) => ({ slug, dbPath: path.join(tenantsDir, slug, 'rsvp.db') }))
    .filter(({ dbPath }) => fs.existsSync(dbPath));
}

function snapshotUploads(destPath) {
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  const entries = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
  if (entries.length === 0) return false;
  execFileSync('tar', ['-czf', destPath, '-C', uploadsDir, '.']);
  return true;
}

async function uploadFile(localPath, key) {
  const { PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
  const Body = fs.readFileSync(localPath);
  const Bucket = process.env.S3_BUCKET;
  const Key = PREFIX + key;
  await client.send(new PutObjectCommand({ Bucket, Key, Body }));
  // Leitura de volta para confirmar que o objeto chegou íntegro ao bucket.
  const head = await client.send(new HeadObjectCommand({ Bucket, Key }));
  if (Number(head.ContentLength) !== Body.length) {
    throw new Error(`tamanho divergente no bucket (${head.ContentLength} ≠ ${Body.length}) para ${Key}`);
  }
}

function rotateLocal() {
  const files = fs.readdirSync(backupsDir);
  for (const ext of ['.db', '.tar.gz']) {
    const matching = files
      .filter((f) => f.endsWith(ext))
      .map((f) => ({ f, t: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    matching.slice(KEEP).forEach(({ f }) => {
      try { fs.unlinkSync(path.join(backupsDir, f)); } catch { /* ignora */ }
    });
  }
}

let lastResult = { at: null, ok: null, dbs: null, uploads: null, remote: null, error: null };
let running = false;

async function runBackup({ reason = 'manual' } = {}) {
  const s = stamp();
  const upName = `uploads-${s}.tar.gz`;
  const upPath = path.join(backupsDir, upName);

  const routerPath = path.join(DATA_DIR, 'router.db');
  const tenants = listTenantDbs();
  const dbNames = [];

  const result = { at: new Date().toISOString(), reason, ok: false, dbs: [], uploads: null, remote: 'desativado', error: null };

  try {
    // Snapshot do banco de roteamento global
    if (fs.existsSync(routerPath)) {
      const name = `router-${s}.db`;
      snapshotDbFile(routerPath, path.join(backupsDir, name));
      dbNames.push(name);
    }

    // Snapshot de cada banco de tenant
    for (const { slug, dbPath } of tenants) {
      const name = `tenant-${slug}-${s}.db`;
      snapshotDbFile(dbPath, path.join(backupsDir, name));
      dbNames.push(name);
    }

    result.dbs = dbNames;

    const hasUploads = snapshotUploads(upPath);
    if (hasUploads) result.uploads = upName;

    if (s3Configured()) {
      try {
        for (const name of dbNames) {
          await uploadFile(path.join(backupsDir, name), name);
        }
        if (hasUploads) await uploadFile(upPath, upName);
        result.remote = 'enviado';
      } catch (e) {
        result.remote = 'falhou';
        result.error = `upload: ${e.message}`;
      }
    }

    rotateLocal();
    result.ok = result.error === null;
  } catch (e) {
    result.error = e.message;
    result.ok = false;
  }

  lastResult = result;
  return result;
}

function listLocal() {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((f) => f.endsWith('.db') || f.endsWith('.tar.gz'))
    .map((f) => {
      const st = fs.statSync(path.join(backupsDir, f));
      return { name: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

function status() {
  return {
    s3Configured: s3Configured(),
    bucket: process.env.S3_BUCKET || null,
    prefix: PREFIX,
    keep: KEEP,
    intervalHours: intervalHours(),
    last: lastResult,
    local: listLocal(),
  };
}

function logResult(r) {
  if (!r) return;
  console.log(`[backup] ${r.reason} ${r.ok ? 'OK' : 'FALHOU'} | dbs=${r.dbs ? r.dbs.length : 0} uploads=${r.uploads || '—'} remoto=${r.remote}${r.error ? ' | erro=' + r.error : ''}`);
}

async function safeRunBackup(reason = 'manual') {
  if (running) {
    console.warn(`[backup] ${reason} pulado — backup anterior ainda em andamento.`);
    return null;
  }
  running = true;
  try { return await runBackup({ reason }); }
  finally { running = false; }
}

function scheduleBackups() {
  const hours = intervalHours();
  if (!hours || hours <= 0) {
    console.log('[backup] job automático desativado (BACKUP_INTERVAL_HOURS=0).');
    return;
  }
  const ms = hours * 3600 * 1000;
  const fire = (reason) => {
    safeRunBackup(reason).then(logResult).catch((e) => console.error(`[backup] ${reason} erro:`, e.message));
  };
  setTimeout(() => fire('boot'), 60_000).unref();
  setInterval(() => fire('agendado'), ms).unref();
  if (s3Configured()) {
    console.log(`[backup] job automático a cada ${hours}h | storage externo: CONFIGURADO`);
  } else if (process.env.NODE_ENV === 'production') {
    console.error(`[backup] 🚨 CRÍTICO EM PRODUÇÃO: storage externo NÃO configurado. Os backups ficam SÓ no volume do Railway — se o volume for perdido, o banco E os backups vão junto. Configure S3_BUCKET / S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY AGORA. (Job a cada ${hours}h, só local.)`);
  } else {
    console.warn(`[backup] ⚠️  AVISO: storage externo NÃO configurado — backups só locais. Job a cada ${hours}h.`);
  }
}

module.exports = { runBackup, safeRunBackup, listLocal, status, scheduleBackups, backupsDir, s3Configured };
