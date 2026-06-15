const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/backup — baixa um snapshot consistente do banco (apenas admin).
// Usa "VACUUM INTO", que gera uma cópia íntegra mesmo com o sistema em uso.
router.get('/', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmp = path.join(os.tmpdir(), `moura-rsvp-backup-${stamp}-${Math.random().toString(36).slice(2, 7)}.db`);
  try {
    // VACUUM INTO exige que o arquivo de destino não exista.
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (e) {
    return res.status(500).json({ error: 'Não foi possível gerar o backup.' });
  }
  logActivity(req.admin.name || req.admin.email, 'baixou backup do sistema', null);
  res.download(tmp, `moura-rsvp-backup-${stamp}.db`, (err) => {
    fs.unlink(tmp, () => {}); // remove o temporário após o envio
    if (err && !res.headersSent) res.status(500).json({ error: 'Falha ao enviar o backup.' });
  });
});

module.exports = router;
