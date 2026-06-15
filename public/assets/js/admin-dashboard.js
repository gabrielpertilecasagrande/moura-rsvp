requireSession();
mountShell('dashboard');

// Cor dinâmica para taxas: <50 vermelho, 50-79 laranja, 80+ verde.
function rateTone(pct) { if (pct >= 80) return 'green'; if (pct >= 50) return 'amber'; return 'red'; }
const ICO = {
  cal: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  rate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
};
const STAT_DEFS = [
  { k: 'totalEvents', l: 'Total de eventos', tone: 'navy', ico: ICO.cal },
  { k: 'activeEvents', l: 'Eventos ativos', tone: 'green', ico: ICO.bolt },
  { k: 'confirmed', l: 'Confirmações', tone: 'green', ico: ICO.check },
  { k: 'declined', l: 'Recusas', tone: 'red', ico: ICO.x },
  { k: 'pending', l: 'Respostas pendentes', tone: 'amber', ico: ICO.clock },
];

function statCard(d) {
  const tip = d.tip ? `<span class="info-i" title="${d.tip}">i</span>` : '';
  return `<div class="stat tone-${d.tone}">
    <div class="stat-top"><span class="stat-ico">${d.ico || ''}</span><span class="l">${d.l}${tip}</span></div>
    <div class="n">${d.n}</div>
  </div>`;
}

async function init() {
  const s = await Api.get('/api/dashboard');
  const cards = STAT_DEFS.map((d) => statCard({ ...d, n: s[d.k] ?? 0 }));
  if (s.responseRate != null) {
    cards.push(statCard({
      n: s.responseRate + '%', l: 'Taxa de resposta', tone: rateTone(s.responseRate), ico: ICO.rate,
      tip: `Proporção de quem já respondeu (confirmou ou recusou) entre os ${s.totalExpected} convidados esperados.`,
    }));
  }
  document.getElementById('stats').innerHTML = cards.join('');

  const events = await Api.get('/api/events');
  const box = document.getElementById('events');
  if (!events.length) {
    box.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ico">📅</div>
      <h3>Nenhum evento cadastrado ainda.</h3>
      <p>Clique em "Novo evento" para começar.</p>
      <a href="/admin/event-form.html" class="btn btn-primary" style="margin-top:14px">+ Novo evento</a>
    </div>`;
    return;
  }
  box.innerHTML = events.map(eventCard).join('');
}

function deadlineTag(e) {
  if (e.status !== 'ativo') return '';
  if (!e.rsvp_deadline) return '';
  const end = new Date(`${e.rsvp_deadline}T23:59:59`).getTime();
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (Date.now() > end && !e.force_open) return '<span class="deadline-tag deadline-red">Prazo encerrado</span>';
  if (days <= 7) return `<span class="deadline-tag deadline-amber">Faltam ${days} dia(s)</span>`;
  return '<span class="deadline-tag deadline-green">Prazo aberto</span>';
}

function eventCard(e) {
  const cover = e.cover_image
    ? `<div class="cover" style="background-image:url('${e.cover_image}')"></div>`
    : `<div class="cover"><span class="ph">SEM CAPA</span></div>`;
  const statusPill = e.status === 'ativo'
    ? '<span class="pill pill-active">Ativo</span>' : '<span class="pill pill-inactive">Inativo</span>';
  return `
  <div class="event-card">
    <a href="/admin/event-detail.html?id=${e.id}" style="text-decoration:none;color:inherit">
      ${cover}
      <div class="body">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
          <h3>${esc(e.name)}</h3>${statusPill}
        </div>
        <div class="meta">${e.event_date ? fmtDateBR(e.event_date) : 'Data a definir'}${e.location ? ' · ' + esc(e.location) : ''}</div>
        <div style="margin-top:2px">${deadlineTag(e)}</div>
        <div class="nums">
          <span><b>${e.total_responses}</b> respostas</span>
          <span style="color:#0f8a4a"><b>${e.confirmed}</b> confirmados</span>
          <span style="color:var(--danger)"><b>${e.declined}</b> recusas</span>
        </div>
      </div>
    </a>
    <div class="event-card-actions">
      <a class="btn btn-primary btn-sm" href="/admin/event-detail.html?id=${e.id}">👁 Ver evento</a>
      <button class="btn btn-ghost btn-sm" onclick="duplicateEvent(${e.id}, event)">Duplicar</button>
    </div>
  </div>`;
}

async function duplicateEvent(id, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (!confirm('Duplicar este evento? Será criada uma cópia com as mesmas configurações, sem os participantes.')) return;
  try {
    const novo = await Api.post(`/api/events/${id}/duplicate`);
    toast('Evento duplicado.');
    location.href = `/admin/event-form.html?id=${novo.id}`;
  } catch (e) { toast(e.message); }
}

// ---- Busca global ----
let gst;
const gs = document.getElementById('globalSearch');
const gr = document.getElementById('searchResults');
gs.addEventListener('input', () => {
  clearTimeout(gst);
  const q = gs.value.trim();
  if (q.length < 2) { gr.classList.add('hidden'); gr.innerHTML = ''; return; }
  gst = setTimeout(() => runSearch(q), 250);
});
document.addEventListener('click', (e) => {
  if (!gr.contains(e.target) && e.target !== gs) gr.classList.add('hidden');
});
async function runSearch(q) {
  try {
    const r = await Api.get(`/api/search?q=${encodeURIComponent(q)}`);
    const parts = [];
    if (r.events.length) {
      parts.push('<div class="sr-group">Eventos</div>');
      parts.push(r.events.map((e) => `<a class="sr-item" href="/admin/event-detail.html?id=${e.id}">
        <span class="sr-ico">📅</span><span><strong>${esc(e.name)}</strong>${e.location ? `<span class="sr-sub">${esc(e.location)}</span>` : ''}</span></a>`).join(''));
    }
    if (r.participants.length) {
      parts.push('<div class="sr-group">Participantes</div>');
      parts.push(r.participants.map((p) => `<a class="sr-item" href="/admin/event-detail.html?id=${p.event_id}">
        <span class="sr-ico">${p.response === 'confirmado' ? '✅' : '❌'}</span>
        <span><strong>${esc(p.name)}</strong><span class="sr-sub">${esc(p.event_name)}${p.email ? ' · ' + esc(p.email) : ''}${p.phone ? ' · ' + esc(p.phone) : ''}</span></span></a>`).join(''));
    }
    gr.innerHTML = parts.join('') || '<div class="sr-empty">Nenhum resultado encontrado.</div>';
    gr.classList.remove('hidden');
  } catch (e) { /* silencioso */ }
}

init().catch((e) => toast(e.message));
document.getElementById('refreshSlot').appendChild(refreshButton(init, 'Atualizar dashboard'));
