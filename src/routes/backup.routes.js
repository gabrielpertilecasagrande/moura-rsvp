const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const backup = require('../utils/backup');

const router = express.Router();

// POST /api/backup/cron?key=<BACKUP_CRON_KEY> — cron externo sem auth de sessão.
// Protegido por chave opaca. Use em cron-job.org, GitHub Actions, etc.
router.post('/cron', async (req, res) => {
  const key = process.env.BACKUP_CRON_KEY;
  if (!key || req.query.key !== key) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const r = await backup.safeRunBackup('cron-externo');
  res.json({ ok: r ? r.ok : false, result: r || 'ocupado' });
});

// Todas as rotas abaixo exigem sessão de admin.
router.use(requireAuth, requireAdmin);

// GET /api/backup — baixa um snapshot consistente do banco do tenant atual.
router.get('/', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmp = path.join(os.tmpdir(), `moura-rsvp-backup-${stamp}-${require('crypto').randomBytes(4).toString('hex')}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    // Restringe a leitura ao dono do processo enquanto o arquivo aguarda o envio.
    try { fs.chmodSync(tmp, 0o600); } catch { /* best-effort */ }
  } catch (e) {
    return res.status(500).json({ error: 'Não foi possível gerar o backup.' });
  }
  logActivity(req.admin.name || req.admin.email, 'baixou backup do sistema', null);
  res.download(tmp, `moura-rsvp-backup-${stamp}.db`, (err) => {
    fs.unlink(tmp, () => {});
    if (err && !res.headersSent) res.status(500).json({ error: 'Falha ao enviar o backup.' });
  });
});

// GET /api/backup/status — status do backup automático (S3, último resultado, local).
router.get('/status', (_req, res) => {
  res.json(backup.status());
});

// POST /api/backup/run — dispara backup completo imediato (todos os tenants + uploads).
router.post('/run', async (_req, res) => {
  const r = await backup.safeRunBackup('manual-admin');
  if (!r) return res.json({ ok: false, message: 'Backup já em andamento.' });
  res.json({ ok: r.ok, result: r });
});

module.exports = router;
