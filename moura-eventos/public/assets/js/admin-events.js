requireSession();
mountShell('events');

if (!canCreateEvents()) {
  document.getElementById('newEventBtn')?.classList.add('hidden');
}

function statusPillClass(s) {
  const map = {
    'Planejamento':     'pill',
    'Contratação':      'pill pill-active',
    'Produção':         'pill pill-ok',
    'Evento realizado': 'pill pill-ok',
    'Encerrado':        'pill',
  };
  return map[s] || 'pill';
}

let allEvents = [];

async function load() {
  const q      = document.getElementById('searchInput').value.trim();
  const status = document.getElementById('statusFilter').value;
  const params = new URLSearchParams();
  if (q)      params.set('q', q);
  if (status) params.set('status', status);

  allEvents = await Api.get('/api/events?' + params.toString());
  renderList(allEvents);
  renderStats(allEvents);
}

function renderStats(events) {
  const counts = {};
  events.forEach((e) => { counts[e.status] = (counts[e.status] || 0) + 1; });
  const statuses = ['Planejamento', 'Contratação', 'Produção', 'Evento realizado', 'Encerrado'];
  const tones = ['tone-gray', 'tone-cyan', 'tone-navy', 'tone-cyan', 'tone-gray'];
  document.getElementById('statusStats').innerHTML = statuses.map((s, i) => `
    <div class="stat ${tones[i]}">
      <div class="stat-value">${counts[s] || 0}</div>
      <div class="stat-label">${s}</div>
    </div>
  `).join('');
}

function renderList(events) {
  const el = document.getElementById('eventList');
  if (!events.length) {
    el.innerHTML = '<p class="muted">Nenhum evento encontrado.</p>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Evento</th><th>Cliente</th><th>Data</th><th>Cidade</th><th>Responsável</th>
      <th>Status</th><th>Contratos</th><th>Tarefas abertas</th><th></th>
    </tr></thead>
    <tbody>
    ${events.map((e) => `<tr>
      <td><a href="/admin/event-detail.html?id=${e.id}" style="font-weight:600">${esc(e.name)}</a></td>
      <td>${esc(e.client || '—')}</td>
      <td style="white-space:nowrap">${e.event_date ? fmtDateBR(e.event_date) : '—'}</td>
      <td>${esc(e.city || '—')}</td>
      <td>${esc(e.responsible || '—')}</td>
      <td><span class="${statusPillClass(e.status)}">${esc(e.status)}</span></td>
      <td style="text-align:center">${e.contracts_count || 0}</td>
      <td style="text-align:center">${e.open_tasks > 0 ? `<span class="pill pill-no">${e.open_tasks}</span>` : '—'}</td>
      <td style="white-space:nowrap">
        <a href="/admin/event-detail.html?id=${e.id}" class="btn btn-ghost btn-sm">Ver</a>
        ${canCreateEvents() ? `<a href="/admin/event-form.html?id=${e.id}" class="btn btn-ghost btn-sm">Editar</a>` : ''}
      </td>
    </tr>`).join('')}
    </tbody>
  </table></div>`;
}

let debounce;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 300);
});
document.getElementById('statusFilter').addEventListener('change', load);

load().catch(console.error);
