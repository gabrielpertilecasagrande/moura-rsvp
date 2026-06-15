// Normaliza nomes para deduplicação: minúsculas, sem acento, espaços colapsados.
function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
module.exports = { normalizeName };
