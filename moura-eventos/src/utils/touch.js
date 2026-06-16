// Atualiza o updated_at do evento quando há atividade em seus sub-recursos
// (contratações, checklist, arquivos, diário). Assim o "Atualizado em" da
// tela de detalhe reflete a última movimentação real do evento.
const db = require('../db');

function touchEvent(eventId) {
  try {
    db.prepare("UPDATE events SET updated_at = datetime('now') WHERE id = ?").run(Number(eventId));
  } catch { /* não bloqueia a operação principal */ }
}

module.exports = { touchEvent };
