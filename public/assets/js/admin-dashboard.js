requireSession();
mountShell('dashboard');

// Operador não cria eventos: oculta o botão "Novo evento" do topo.
if (!canCreateEvents()) document.getElementById('newEventBtn')?.remove();

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
  { k: 'totalEvents',   l: 'Total de eventos',    tone: 'navy',  ico: ICO.cal },
  { k: 'activeEvents',  l: 'Eventos ativos',       tone: 'green', ico: ICO.bolt },
  { k: 'confirmed',     l: 'Confirmados',           tone: 'green', ico: ICO.check },
  { k: 'declined',      l: 'Recusas',               ico: ICO.x,   toneFn: (v) => v > 0 ? 'red' : 'gray' },
  { k: 'responseRate',  l: 'Taxa de resposta',      tone: 'amber', ico: ICO.rate, fmt: (v) => v !== null ? v + '%' : '—', tip: 'Proporção de respostas em relação ao total de convidados esperados. Configure "Convidados esperados" nos eventos para calcular.' },
  { k: 'pending',       l: 'Aguardando',            tone: 'amber', ico: ICO.clock, tip: 'Considera apenas eventos com "Convidados esperados" definido.' },
];

function statCard(d) {
  const tip = d.tip ? `<span class="info-i" title="${d.tip}">i</span>` : '';
  return `<div class="stat tone-${d.tone}">
    <div class="stat-top"><span class="stat-ico">${d.ico || ''}</span><span class="l">${d.l}${tip}</span></div>
    <div class="n">${d.n}</div>
  </div>`;
}

let ALL_EVENTS = [];
let eventsTab = 'current'; // 'current' | 'past'

// Um evento é "passado/concluído" quando a data de realização já passou.
function isPastEvent(e) {
  if (!e.event_date) return false;
  const end = new Date(`${e.event_date}T23:59:59`).getTime();
  return Date.now() > end;
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 1000);
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h atrás`;
  return `${Math.floor(diff / 86400)} d atrás`;
}

function renderDashExtra(recent, daily) {
  const slot = document.getElementById('dashExtra');
  if (!slot) return;
  if ((!recent || !recent.length) && (!daily || !daily.length)) {
    slot.innerHTML = '';
    return;
  }
  let html = '<div class="dash-extra-grid">';

  // Últimas confirmações
  if (recent && recent.length) {
    const TONES = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rows = recent.map((r, i) => {
      const initials = (r.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      const tone = TONES[i % TONES.length];
      return `
      <div class="recent-row">
        <span class="recent-avatar" data-tone="${tone}">${esc(initials)}</span>
        <span class="recent-body">
          <span class="recent-name">${esc(r.name)}</span>
          <span class="recent-sub"><span class="recent-event-badge">${esc(r.event_name)}</span><span class="recent-time">${relTime(r.updated_at)}</span></span>
        </span>
      </div>`;
    }).join('');
    html += `<div><div class="section-label">Últimas confirmações</div><div class="card recent-list">${rows}</div></div>`;
  }

  // Gráfico de confirmações por dia (últimos 7 dias)
  if (daily && daily.length) {
    const today = new Date();
    const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const days7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    const byDate = {};
    daily.forEach((item) => { byDate[item.date] = item.n || 0; });
    const values = days7.map((dt) => byDate[dt] || 0);
    const max = Math.max(...values, 1);
    const bars = days7.map((dt, i) => {
      const pct = Math.round((values[i] / max) * 100);
      const d = new Date(dt + 'T12:00:00');
      const label = DAY_LABELS[d.getDay()];
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:4px">
        <div style="width:100%;height:80px;display:flex;align-items:flex-end">
          <div style="width:100%;height:${pct}%;background:var(--navy,#1e3a5f);border-radius:3px 3px 0 0;min-height:${values[i] > 0 ? '4px' : '0'}" title="${values[i]} confirmação(ões)"></div>
        </div>
        <div style="font-size:11px;color:var(--muted,#64748b);font-weight:500">${label}</div>
        <div style="font-size:11px;color:var(--muted,#64748b)">${values[i]}</div>
      </div>`;
    }).join('');
    html += `<div>
      <div class="section-label">Confirmações por dia (últimos 7 dias)</div>
      <div class="card" style="padding:16px 12px 10px">
        <div style="display:flex;gap:6px;align-items:flex-end">${bars}</div>
      </div>
    </div>`;
  }

  html += '</div>';
  slot.innerHTML = html;
}

async function init() {
  const s = await Api.get('/api/dashboard');
  const cards = STAT_DEFS.map((d) => {
    const val = s[d.k] ?? 0;
    return statCard({ ...d, tone: d.toneFn ? d.toneFn(val) : d.tone, n: d.fmt ? d.fmt(s[d.k]) : val });
  });
  document.getElementById('stats').innerHTML = cards.join('');
  renderDashExtra(s.recent, s.daily);

  ALL_EVENTS = await Api.get('/api/events');
  renderEvents();
}

function sortByDate(arr) {
  return [...arr].sort((a, b) => {
    if (!a.event_date && !b.event_date) return 0;
    if (!a.event_date) return 1;
    if (!b.event_date) return -1;
    return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0;
  });
}

function renderEvents() {
  const current = sortByDate(ALL_EVENTS.filter((e) => !isPastEvent(e)));
  const past = sortByDate(ALL_EVENTS.filter(isPastEvent));
  const list = eventsTab === 'past' ? past : current;

  // Abas de eventos atuais x passados/concluídos.
  const tabs = document.getElementById('eventTabs');
  tabs.innerHTML = `
    <button data-tab="current" class="${eventsTab === 'current' ? 'active' : ''}">Eventos atuais (${current.length})</button>
    <button data-tab="past" class="${eventsTab === 'past' ? 'active' : ''}">Eventos passados/concluídos (${past.length})</button>`;

  const box = document.getElementById('events');
  if (!ALL_EVENTS.length) {
    box.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ico">${Icon('calendar')}</div>
      <h3>${canCreateEvents() ? 'Nenhum evento cadastrado ainda.' : 'Você ainda não tem eventos liberados.'}</h3>
      <p>${canCreateEvents() ? 'Clique em "Novo evento" para começar.' : 'Solicite a um administrador o acesso aos eventos.'}</p>
      ${canCreateEvents() ? '<a href="/admin/event-form.html" class="btn btn-primary" style="margin-top:14px">+ Novo evento</a>' : ''}
    </div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="ico">${Icon('folder')}</div>
      <h3>${eventsTab === 'past' ? 'Nenhum evento passado por aqui.' : 'Nenhum evento em andamento.'}</h3></div>`;
    return;
  }
  box.innerHTML = list.map(eventCard).join('');
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
        <div class="meta">${e.event_date ? fmtDateBR(e.event_date) : '<span class="badge-sem-data">Sem data</span>'}${e.location ? ' · ' + esc(e.location) : ''}</div>
        <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">${e.source_event_id ? '<span class="origin-selo">◆ Moura One</span>' : ''}${e.ref_code ? `<span class="origin-ref">${esc(e.ref_code)}</span>` : ''}</div>
        <div style="margin-top:2px">${deadlineTag(e)}</div>
        <div class="nums">
          <span><b>${e.total_responses}</b> respostas</span>
          <span style="color:#0f8a4a"><b>${e.confirmed}</b> confirmados</span>
          <span style="color:var(--danger)"><b>${e.declined}</b> recusas</span>
        </div>
      </div>
    </a>
    <div class="event-card-actions">
      <a class="btn btn-primary btn-sm" href="/admin/event-detail.html?id=${e.id}">${Icon('report')} Ver evento</a>
      ${(e._perms && e._perms.can_duplicate) ? `<button class="btn btn-ghost btn-sm" onclick="duplicateEvent(${e.id}, event)">Duplicar</button>` : ''}
    </div>
  </div>`;
}

async function duplicateEvent(id, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (!confirm('Duplicar este evento? Será criada uma cópia com as mesmas configurações, sem os convidados.')) return;
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
  gr.innerHTML = '<div class="sr-empty">Buscando…</div>';
  gr.classList.remove('hidden');
  try {
    const r = await Api.get(`/api/search?q=${encodeURIComponent(q)}`);
    const parts = [];
    if (r.events.length) {
      parts.push('<div class="sr-group">Eventos</div>');
      parts.push(r.events.map((e) => `<a class="sr-item" href="/admin/event-detail.html?id=${e.id}">
        <span class="sr-ico">${Icon('calendar')}</span><span><strong>${esc(e.name)}</strong>${e.location ? `<span class="sr-sub">${esc(e.location)}</span>` : ''}</span></a>`).join(''));
    }
    if (r.participants.length) {
      parts.push('<div class="sr-group">Convidados</div>');
      parts.push(r.participants.map((p) => `<a class="sr-item" href="/admin/event-detail.html?id=${p.event_id}">
        <span class="sr-ico">${p.response === 'confirmado' ? '✅' : '❌'}</span>
        <span><strong>${esc(p.name)}</strong><span class="sr-sub">${esc(p.event_name)}${p.email ? ' · ' + esc(p.email) : ''}${p.phone ? ' · ' + esc(p.phone) : ''}</span></span></a>`).join(''));
    }
    gr.innerHTML = parts.join('') || '<div class="sr-empty">Nenhum resultado encontrado.</div>';
    gr.classList.remove('hidden');
  } catch (e) {
    gr.innerHTML = '<div class="sr-empty">Não foi possível buscar agora. Verifique sua conexão e tente novamente.</div>';
    gr.classList.remove('hidden');
  }
}

document.getElementById('eventTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  eventsTab = b.dataset.tab;
  renderEvents();
});

init().catch((e) => toast(e.message));
document.getElementById('refreshSlot').appendChild(refreshButton(init, 'Atualizar dashboard'));
