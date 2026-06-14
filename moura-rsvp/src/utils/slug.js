// Gera slug a partir do nome do evento + garante unicidade no banco.
function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60);
}

function uniqueSlug(db, base) {
  let slug = slugify(base) || 'evento';
  const exists = db.prepare('SELECT 1 FROM events WHERE slug = ?');
  if (!exists.get(slug)) return slug;
  let i = 2;
  while (exists.get(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

module.exports = { slugify, uniqueSlug };
