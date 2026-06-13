requireSession();
mountShell();

const ID = new URLSearchParams(location.search).get('id');
let state = { filter: '', q: '' };
let EVENT = null;

async function loadEvent() {
  EVENT = await Api.get(`/api/events/${ID}`);
  document.getElementById('evName').textContent = EVENT.name;
  document.title = `${EVENT.name} — Moura RSVP`;
  document.getElementById('evMeta').textContent =
    `${EVENT.event_date ? fmtDateBR(EVENT.event_date) : 'Data a definir'}${EVENT.event_time ? ' · ' + EVENT.event_time : ''}${EVENT.location ? ' · ' + EVENT.location : ''}`;
  document.getElementById('publicUrl').textContent = EVENT.public_url;
  document.getElementById('openPublic').href = EVENT.public_url;
  document.getElementById('editBtn').href = `/admin/event-form.html?id=${ID}`;
}

async function loadParticipants() {
  const params = new URLSearchParams();
  if (state.filter) params.set('filter', state.filter);
  if (state.q) params.set('q', state.q);
  const data = await Api.get(`/api/events/${ID}/participants?${params}`);
  renderStats(data.stats);
  renderRows(data.participants);
}

function renderStats(s) {
  const defs = [
    { n: s.total, l: 'Respostas' },
    { n: s.confirmed, l: 'Confirmados', accent: true },
    { n: s.declined, l: 'Recusas' },
    { n: s.confirmation_rate + '%', l: 'Taxa de confirmação' },
  ];
  document.getElementById('pStats').innerHTML = defs.map((d) =>
    `<div class="stat ${d.accent ? 'accent' : ''}"><div class="n">${d.n}</div><div class="l">${d.l}</div></div>`).join('');
}

function renderRows(list) {
  const tb = document.getElementById('rows');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="8" class="muted center" style="padding:30px">Nenhuma resposta encontrada${state.q || state.filter ? ' com os filtros aplicados' : ' ainda'}.</td></tr>`;
    return;
  }
  tb.innerHTML = list.map((p) => `
    <tr>
      <td class="row-name">${esc(p.name)}</td>
      <td>${esc(p.company) || '—'}</td>
      <td>${esc(p.role) || '—'}</td>
      <td>${esc(p.email) || '—'}</td>
      <td>${esc(p.phone) || '—'}</td>
      <td><span class="pill ${p.response === 'confirmado' ? 'pill-ok' : 'pill-no'}">${p.response === 'confirmado' ? 'Confirmado' : 'Recusado'}</span></td>
      <td style="white-space:nowrap;font-variant-numeric:tabular-nums">${fmtDateTimeBR(p.updated_at)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="showAudit(${p.id}, '${esc(p.name).replace(/'/g, "")}')">Histórico</button></td>
    </tr>`).join('');
}

async function showAudit(pid, name) {
  const log = await Api.get(`/api/events/${ID}/participants/${pid}/audit`);
  const lines = log.map((a) => `
    <div class="audit-line"><span class="d">${fmtDateTimeBR(a.created_at)}</span> — ${esc(a.details || a.action)}</div>`).join('') || '<p class="muted">Sem registros.</p>';
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Histórico de alterações</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px">${esc(name)}</p>
    <div style="text-align:left">${lines}</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:18px" onclick="closeModal()">Fechar</button>`);
}

function modal(html) { document.getElementById('modalSlot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }

function exportUrl(format) {
  const p = new URLSearchParams({ format });
  if (state.filter) p.set('filter', state.filter);
  if (state.q) p.set('q', state.q);
  return `/api/events/${ID}/participants/export?${p}`;
}
async function download(format) {
  const res = await fetch(exportUrl(format), { headers: { Authorization: `Bearer ${Api.token()}` } });
  if (!res.ok) return toast('Erro ao exportar.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rsvp-${EVENT.slug}.${format === 'csv' ? 'csv' : 'xlsx'}`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ---- Eventos de interface ----
document.getElementById('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(EVENT.public_url); toast('Link copiado.'); }
  catch { toast('Copie manualmente: ' + EVENT.public_url); }
});
document.getElementById('qrBtn').addEventListener('click', () => {
  modal(`<h3 style="font-size:17px">QR Code do evento</h3>
    <img alt="QR Code" style="background:var(--off-white)" />
    <p class="muted" style="font-size:12px;margin:0 0 14px">Aponte a câmera para abrir o link de confirmação.</p>
    <a class="btn btn-primary btn-sm" download="qrcode-${EVENT.slug}.png">Baixar PNG</a>
    <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="closeModal()">Fechar</button>`);
  fetchQr();
});
async function fetchQr() {
  const res = await fetch(`/api/events/${ID}/qrcode`, { headers: { Authorization: `Bearer ${Api.token()}` } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const img = document.querySelector('.modal img');
  if (img) img.src = url;
  const dl = document.querySelector('.modal a');
  if (dl) dl.href = url;
}
document.getElementById('seg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#seg button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); state.filter = b.dataset.f; loadParticipants();
});
let searchT;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value; loadParticipants(); }, 250);
});
document.getElementById('csvBtn').addEventListener('click', () => download('csv'));
document.getElementById('xlsxBtn').addEventListener('click', () => download('xlsx'));

(async () => { await loadEvent(); await loadParticipants(); })().catch((e) => toast(e.message));
