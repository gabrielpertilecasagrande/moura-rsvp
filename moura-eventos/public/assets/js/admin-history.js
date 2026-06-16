requireSession();
mountShell('history');

const EVENT_TYPES = ['Social', 'Social corporativo', 'Fórum', 'Congresso', 'Convenção', 'Feira', 'Seminário', 'Jantar', 'Lançamento', 'Reunião'];

let searchQ = '', filterType = '', filterYear = '';
let yearsLoaded = false;

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function statusPillClass(s) {
  const map = { 'Evento realizado': 'pill pill-ok', 'Encerrado': 'pill' };
  return map[s] || 'pill';
}

// Preenche o select de tipos uma vez.
document.getElementById('typeFilter').innerHTML =
  '<option value="">Todos os tipos</option>' + EVENT_TYPES.map((t) => `<option>${t}</option>`).join('');

async function load() {
  const params = new URLSearchParams();
  if (searchQ)    params.set('q', searchQ);
  if (filterType) params.set('type', filterType);
  if (filterYear) params.set('year', filterYear);

  const data = await Api.get('/api/history?' + params.toString());
  renderStats(data.summary);
  renderBenchmark(data.byType);
  renderList(data.events);

  // Popula o filtro de anos só na primeira carga (sem filtros), para não sumir opções.
  if (!yearsLoaded && !filterYear && !filterType && !searchQ) {
    const yf = document.getElementById('yearFilter');
    yf.innerHTML = '<option value="">Todos os anos</option>' + (data.years || []).map((y) => `<option>${y}</option>`).join('');
    yearsLoaded = true;
  }
}

function renderStats(s) {
  document.getElementById('histStats').innerHTML = `
    <div class="hist-stat"><div class="n">${s.count}</div><div class="l">Eventos realizados</div></div>
    <div class="hist-stat"><div class="n">${fmtMoney(s.total)}</div><div class="l">Total investido</div></div>
    <div class="hist-stat"><div class="n">${fmtMoney(s.avg)}</div><div class="l">Custo médio por evento</div></div>
  `;
}

function renderBenchmark(byType) {
  const el = document.getElementById('benchmark');
  if (!byType || !byType.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<h3>Custo médio por tipo de evento (referência para orçamentos)</h3>
    ${byType.map((t) => `<div class="bench-row">
      <span class="bt">${esc(t.type)}</span>
      <span class="bc">${t.count} evento(s)</span>
      <span class="ba">${fmtMoney(t.avg)}</span>
    </div>`).join('')}`;
}

function renderList(events) {
  const el = document.getElementById('histList');
  if (!events.length) {
    el.innerHTML = '<p class="muted" style="padding:24px 0">Nenhum evento anterior encontrado com esses filtros.</p>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="cards">
    <thead><tr><th>Evento</th><th>Tipo</th><th>Data</th><th>Contratações</th><th>Investido</th><th>Status</th><th></th></tr></thead>
    <tbody>
    ${events.map((e) => {
      const sub = [e.client, e.city].filter(Boolean).join(' · ');
      return `<tr>
        <td class="row-name" data-label="Evento">
          <a href="/admin/event-detail.html?id=${e.id}" style="font-weight:600">${esc(e.name)}</a>
          ${sub ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(sub)}</div>` : ''}
        </td>
        <td data-label="Tipo">${e.event_type ? `<span class="pill">${esc(e.event_type)}</span>` : '—'}</td>
        <td data-label="Data" style="white-space:nowrap">${e.event_date ? fmtDateBR(e.event_date) : '—'}</td>
        <td data-label="Contratações">${e.suppliers_count || 0}</td>
        <td data-label="Investido" style="white-space:nowrap">${fmtMoney(e.total_value)}</td>
        <td data-label="Status"><span class="${statusPillClass(e.status)}">${esc(e.status)}</span></td>
        <td class="cell-actions" data-label="Ações"><a href="/admin/event-detail.html?id=${e.id}" class="btn btn-ghost btn-sm">Ver</a></td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;
}

let debounce;
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQ = e.target.value.trim();
  clearTimeout(debounce);
  debounce = setTimeout(load, 300);
});
document.getElementById('typeFilter').addEventListener('change', (e) => { filterType = e.target.value; load(); });
document.getElementById('yearFilter').addEventListener('change', (e) => { filterYear = e.target.value; load(); });

load().catch(console.error);
