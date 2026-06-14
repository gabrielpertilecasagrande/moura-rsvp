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

let LAST_LIST = [];
function renderRows(list) {
  LAST_LIST = list;
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
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="editParticipant(${p.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="showAudit(${p.id})">Histórico</button>
      </td>
    </tr>`).join('');
}

const fieldRow = (id, label, value, type = 'text') =>
  `<div class="field" style="text-align:left"><label>${label}</label><input type="${type}" id="${id}" value="${esc(value) || ''}" /></div>`;

function editParticipant(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  if (!p) return;
  const yes = p.response === 'confirmado';
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Editar participante</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">As alterações ficam registradas no histórico.</p>
    ${fieldRow('ed_name', 'Nome completo', p.name)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ed_company', 'Empresa', p.company)}
      ${fieldRow('ed_role', 'Cargo', p.role)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ed_email', 'E-mail', p.email, 'email')}
      ${fieldRow('ed_phone', 'Telefone', p.phone)}
    </div>
    <div class="field" style="text-align:left">
      <label>Presença</label>
      <div class="edit-presence">
        <label class="ep ${yes ? 'on' : ''}"><input type="radio" name="ed_resp" value="confirmado" ${yes ? 'checked' : ''}/> Confirmado</label>
        <label class="ep ${!yes ? 'on' : ''}"><input type="radio" name="ed_resp" value="recusado" ${!yes ? 'checked' : ''}/> Recusado</label>
      </div>
    </div>
    <p class="error-msg hidden" id="ed_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveParticipant(${pid})">Salvar alterações</button>
    </div>`);
  document.querySelectorAll('.edit-presence .ep').forEach((lab) => {
    lab.addEventListener('click', () => {
      document.querySelectorAll('.edit-presence .ep').forEach((x) => x.classList.remove('on'));
      lab.classList.add('on');
    });
  });
}

async function saveParticipant(pid) {
  const val = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('ed_err');
  if (!val('ed_name')) { err.textContent = 'O nome é obrigatório.'; err.classList.remove('hidden'); return; }
  const payload = {
    name: val('ed_name'), company: val('ed_company'), role: val('ed_role'),
    email: val('ed_email'), phone: val('ed_phone'),
    response: document.querySelector('input[name="ed_resp"]:checked').value,
  };
  try {
    await Api.put(`/api/events/${ID}/participants/${pid}`, payload);
    closeModal();
    toast('Participante atualizado.');
    loadParticipants();
  } catch (e) {
    err.textContent = e.message; err.classList.remove('hidden');
  }
}

async function showAudit(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  const name = p ? p.name : '';
  const log = await Api.get(`/api/events/${ID}/participants/${pid}/audit`);
  const lines = log.map((a) => `
    <div class="audit-line"><span class="d">${fmtDateTimeBR(a.created_at)}</span>${a.actor ? ' · <strong>' + esc(a.actor) + '</strong>' : ''} — ${esc(a.details || a.action)}</div>`).join('') || '<p class="muted">Sem registros.</p>';
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
