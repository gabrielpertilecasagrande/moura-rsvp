requireSession();
if (currentRole() !== 'admin') location.href = '/admin/dashboard.html';
mountShell('activity');

const PERIOD_OPTIONS = [
  { label: 'Hoje', days: 0 },
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: 'Todos', days: -1 },
];
let ROWS_ALL = [];
let activePeriod = -1; // -1 = todos
let currentLimit = 200;

function filterByPeriod(rows) {
  if (activePeriod < 0) return rows;
  const now = Date.now();
  const cutoff = activePeriod === 0
    ? new Date(new Date().toDateString()).getTime()
    : now - activePeriod * 86400000;
  return rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
}

function renderRows(rows) {
  ROWS = rows;
  const tb = document.getElementById('rows');
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="4" class="muted center" style="padding:30px">Nenhuma atividade no período.</td></tr>';
    return;
  }
  tb.innerHTML = rows.map((r, i) => {
    const det = r.details || '';
    const detCell = det
      ? `<button type="button" class="act-detail-btn" onclick="showDetail(${i})">${esc(det)} <span class="act-more">ver</span></button>`
      : '<span class="muted">—</span>';
    return `<tr>
      <td class="row-name" style="font-variant-numeric:tabular-nums">${fmtDateTimeBR(r.created_at)}</td>
      <td data-label="Usuário">${esc(r.actor || '—')}</td>
      <td data-label="Ação">${esc(r.action)}</td>
      <td data-label="Detalhe" class="break-anywhere">${detCell}</td>
    </tr>`;
  }).join('');
}

function renderPeriodChips() {
  const wrap = document.getElementById('periodChips');
  wrap.innerHTML = PERIOD_OPTIONS.map((p) =>
    `<button class="cat-filter-btn${activePeriod === p.days ? ' active' : ''}" data-days="${p.days}">${p.label}</button>`
  ).join('');
  wrap.querySelectorAll('[data-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePeriod = Number(btn.getAttribute('data-days'));
      renderPeriodChips();
      const q = document.getElementById('search').value.trim();
      const filtered = q ? ROWS_ALL.filter((r) => [r.actor, r.action, r.details].some((s) => (s || '').toLowerCase().includes(q.toLowerCase()))) : ROWS_ALL;
      renderRows(filterByPeriod(filtered));
    });
  });
}

async function load(q, limit) {
  const lim = limit || currentLimit;
  const params = new URLSearchParams({ limit: lim });
  if (q) params.set('q', q);
  const rows = await Api.get(`/api/activity?${params}`);
  ROWS_ALL = rows;
  const wrap = document.getElementById('loadMoreWrap');
  if (wrap) wrap.style.display = rows.length >= lim ? '' : 'none';
  renderRows(filterByPeriod(rows));
}

let ROWS = [];
function modal(html) { document.getElementById('modalSlot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this&&document._mdTarget===this)closeModal()"><div class="modal" style="max-width:460px;text-align:left">${html}</div></div>`; }
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }
function showDetail(i) {
  const r = ROWS[i]; if (!r) return;
  modal(`
    <h3 style="font-size:17px;margin-bottom:14px">Detalhe da atividade</h3>
    <div class="audit-line"><span class="d">Quando</span><div>${fmtDateTimeBR(r.created_at)}</div></div>
    <div class="audit-line"><span class="d">Usuário</span><div>${esc(r.actor || '—')}</div></div>
    <div class="audit-line"><span class="d">Ação</span><div>${esc(r.action)}</div></div>
    <div class="audit-line" style="border:none"><span class="d">Detalhamento</span><div class="break-anywhere">${esc(r.details || '—')}</div></div>
    <div style="display:flex;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-primary btn-sm" onclick="closeModal()">Fechar</button>
    </div>`);
}

renderPeriodChips();

let t;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 250);
});

document.getElementById('loadMoreBtn').addEventListener('click', () => {
  currentLimit = Math.min(currentLimit + 200, 500);
  load(document.getElementById('search').value.trim(), currentLimit);
});

load().catch((e) => toast(e.message));
document.getElementById('refreshSlot').appendChild(refreshButton(() => load(document.getElementById('search').value.trim()), 'Atualizar'));

// Baixa um backup completo do banco (snapshot consistente).
document.getElementById('backupBtn').addEventListener('click', async () => {
  const btn = document.getElementById('backupBtn');
  btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Gerando…';
  try {
    const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${Api.token()}` } });
    if (!res.ok) throw new Error('Não foi possível gerar o backup.');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date().toISOString().slice(0, 10);
    a.download = `moura-rsvp-backup-${d}.db`;
    a.click(); URL.revokeObjectURL(a.href);
    toast('Backup baixado. Guarde o arquivo em local seguro.');
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = txt; }
});
