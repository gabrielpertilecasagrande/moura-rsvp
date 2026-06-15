// Registro de atividades administrativas (auditoria geral do sistema).
const db = require('../db');

function logActivity(actor, action, details) {
  try {
    db.prepare('INSERT INTO activity_log (actor, action, details) VALUES (?,?,?)')
      .run(actor || 'Sistema', action, details || null);
  } catch { /* não bloqueia a operação principal se o log falhar */ }
}

module.exports = { logActivity };
