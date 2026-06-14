requireSession();
mountShell('dashboard');

const STAT_DEFS = [
  { k: 'totalEvents', l: 'Total de eventos' },
  { k: 'activeEvents', l: 'Eventos ativos' },
  { k: 'confirmed', l: 'Confirmações', accent: true },
  { k: 'declined', l: 'Recusas' },
  { k: 'pending', l: 'Respostas pendentes' },
];

async function init() {
  const s = await Api.get('/api/dashboard');
  document.getElementById('stats').innerHTML = STAT_DEFS.map((d) =>
    `<div class="stat ${d.accent ? 'accent' : ''}"><div class="n">${s[d.k] ?? 0}</div><div class="l">${d.l}</div></div>`
  ).join('');

  const events = await Api.get('/api/events');
  const box = document.getElementById('events');
  if (!events.length) {
    box.innerHTML = `<div class="card center" style="grid-column:1/-1"><p class="muted">Nenhum evento ainda.</p>
      <a href="/admin/event-form.html" class="btn btn-primary" style="margin-top:12px">Criar primeiro evento</a></div>`;
    return;
  }
  box.innerHTML = events.map(eventCard).join('');
}

function eventCard(e) {
  const cover = e.cover_image
    ? `<div class="cover" style="background-image:url('${e.cover_image}')"></div>`
    : `<div class="cover"><span class="ph">SEM CAPA</span></div>`;
  const statusPill = e.status === 'ativo'
    ? '<span class="pill pill-active">Ativo</span>' : '<span class="pill pill-inactive">Inativo</span>';
  return `
  <a class="event-card" href="/admin/event-detail.html?id=${e.id}" style="text-decoration:none;color:inherit">
    ${cover}
    <div class="body">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <h3>${esc(e.name)}</h3>${statusPill}
      </div>
      <div class="meta">${e.event_date ? fmtDateBR(e.event_date) : 'Data a definir'}${e.location ? ' · ' + esc(e.location) : ''}</div>
      <div class="nums">
        <span><b>${e.total_responses}</b> respostas</span>
        <span style="color:#0f8a93"><b>${e.confirmed}</b> confirmados</span>
        <span style="color:var(--danger)"><b>${e.declined}</b> recusas</span>
      </div>
    </div>
  </a>`;
}

init().catch((e) => toast(e.message));
