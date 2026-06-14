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
  renderReopenBanner();
}

// Verifica se o prazo passou (apenas data).
function deadlineGone() {
  if (!EVENT.rsvp_deadline) return false;
  return Date.now() > new Date(`${EVENT.rsvp_deadline}T23:59:59`).getTime();
}

function renderReopenBanner() {
  const wrap = document.getElementById('reopenBanner');
  const past = deadlineGone();
  const reopened = !!EVENT.force_open;
  // Só mostra quando há algo a decidir: prazo passou OU já está reaberto.
  if (!past && !reopened) { wrap.innerHTML = ''; return; }
  if (reopened) {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:18px;border-left:4px solid var(--cyan);display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div><strong>Confirmações reabertas.</strong> <span class="muted">As pessoas podem responder mesmo com o prazo encerrado.</span></div>
        <button class="btn btn-ghost btn-sm" onclick="setReopen(false)">Encerrar novamente</button>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:18px;border-left:4px solid var(--danger);display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div><strong>Prazo encerrado.</strong> <span class="muted">A página pública não aceita novas respostas.</span></div>
        <button class="btn btn-primary btn-sm" onclick="setReopen(true)">Reabrir confirmações</button>
      </div>`;
  }
}

async function setReopen(open) {
  try {
    await Api.req('PATCH', `/api/events/${ID}/reopen`, { open });
    EVENT.force_open = open ? 1 : 0;
    renderReopenBanner();
    toast(open ? 'Confirmações reabertas.' : 'Confirmações encerradas.');
  } catch (e) { toast(e.message); }
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

// Monta link wa.me a partir do telefone do convidado.
function guestWa(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return `https://wa.me/${d}`;
}

let LAST_LIST = [];
function renderRows(list) {
  LAST_LIST = list;
  const tb = document.getElementById('rows');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="8" class="muted center" style="padding:30px">Nenhuma resposta encontrada${state.q || state.filter ? ' com os filtros aplicados' : ' ainda'}.</td></tr>`;
    return;
  }
  tb.innerHTML = list.map((p) => {
    const wa = guestWa(p.phone);
    return `
    <tr>
      <td class="row-name">${esc(p.name)}</td>
      <td data-label="Empresa">${esc(p.company) || '—'}</td>
      <td data-label="Cargo">${esc(p.role) || '—'}</td>
      <td data-label="E-mail" class="break-anywhere">${esc(p.email) || '—'}</td>
      <td data-label="Telefone">${esc(p.phone) || '—'}</td>
      <td data-label="Status"><span class="pill ${p.response === 'confirmado' ? 'pill-ok' : 'pill-no'}">${p.response === 'confirmado' ? 'Confirmado' : 'Recusado'}</span></td>
      <td data-label="Data" style="white-space:nowrap;font-variant-numeric:tabular-nums">${fmtDateTimeBR(p.updated_at)}</td>
      <td class="cell-actions" style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="editParticipant(${p.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="showAudit(${p.id})">Histórico</button>
        ${wa ? `<a class="btn btn-ghost btn-sm" href="${wa}" target="_blank" rel="noopener" style="color:#1a8f4c;border-color:#bfe6cd">Enviar mensagem</a>` : ''}
      </td>
    </tr>`;
  }).join('');
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
const EXT = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };
async function download(format) {
  const res = await fetch(exportUrl(format), { headers: { Authorization: `Bearer ${Api.token()}` } });
  if (!res.ok) return toast('Erro ao exportar.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rsvp-${EVENT.slug}.${EXT[format] || format}`;
  a.click(); URL.revokeObjectURL(a.href);
}

// Baixa o QR Code no formato pedido (autenticado).
async function downloadQr(format) {
  toast('Gerando QR Code…');
  const res = await fetch(`/api/events/${ID}/qrcode?format=${format}`, { headers: { Authorization: `Bearer ${Api.token()}` } });
  if (!res.ok) return toast('Erro ao gerar o QR Code.');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `qrcode-${EVENT.slug}.${format}`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ---- Eventos de interface ----
document.getElementById('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(EVENT.public_url); toast('Link copiado.'); }
  catch { toast('Copie manualmente: ' + EVENT.public_url); }
});
document.getElementById('qrBtn').addEventListener('click', () => {
  modal(`<h3 style="font-size:17px">QR Code do evento</h3>
    <img id="qrPreview" alt="QR Code" style="background:#fff;border:1px solid var(--gray-soft);border-radius:10px" />
    <p class="muted" style="font-size:12px;margin:0 0 14px">Preto e branco. Aponte a câmera para abrir o link de confirmação.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="downloadQr('png')">Baixar PNG</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadQr('jpg')">Baixar JPG</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadQr('svg')">Baixar SVG</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadQr('pdf')">Baixar PDF</button>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px;width:100%" onclick="closeModal()">Fechar</button>`);
  fetchQrPreview();
});
async function fetchQrPreview() {
  const res = await fetch(`/api/events/${ID}/qrcode?format=png`, { headers: { Authorization: `Bearer ${Api.token()}` } });
  const blob = await res.blob();
  const img = document.getElementById('qrPreview');
  if (img) img.src = URL.createObjectURL(blob);
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
document.getElementById('pdfBtn').addEventListener('click', () => download('pdf'));
document.getElementById('addOneBtn').addEventListener('click', addOne);
document.getElementById('addBulkBtn').addEventListener('click', addBulk);

// ---- Inclusão manual e em lote ----
function addOne() {
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Adicionar participante</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">Inclua manualmente uma pessoa já confirmada.</p>
    ${fieldRow('ao_name', 'Nome completo', '')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ao_company', 'Empresa', '')}
      ${fieldRow('ao_role', 'Cargo', '')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${fieldRow('ao_email', 'E-mail', '', 'email')}
      ${fieldRow('ao_phone', 'Telefone', '')}
    </div>
    <div class="field" style="text-align:left">
      <label>Presença</label>
      <div class="edit-presence">
        <label class="ep on"><input type="radio" name="ao_resp" value="confirmado" checked/> Confirmado</label>
        <label class="ep"><input type="radio" name="ao_resp" value="recusado"/> Recusado</label>
      </div>
    </div>
    <p class="error-msg hidden" id="ao_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveOne()">Adicionar</button>
    </div>`);
  document.querySelectorAll('.edit-presence .ep').forEach((lab) => {
    lab.addEventListener('click', () => {
      document.querySelectorAll('.edit-presence .ep').forEach((x) => x.classList.remove('on'));
      lab.classList.add('on');
    });
  });
}
async function saveOne() {
  const v = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('ao_err');
  if (!v('ao_name')) { err.textContent = 'Informe o nome.'; err.classList.remove('hidden'); return; }
  const payload = {
    name: v('ao_name'), company: v('ao_company'), role: v('ao_role'),
    email: v('ao_email'), phone: v('ao_phone'),
    response: document.querySelector('input[name="ao_resp"]:checked').value,
  };
  try { await Api.post(`/api/events/${ID}/participants`, payload); closeModal(); toast('Participante adicionado.'); loadParticipants(); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

function addBulk() {
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Incluir em lote</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px;text-align:left">Cole um nome por linha. Opcional, separando por vírgula: <em>Nome, e-mail, empresa, cargo, telefone</em>. Nomes já existentes são ignorados.</p>
    <div class="field" style="text-align:left">
      <textarea id="bulk_text" rows="8" placeholder="Maria Silva, maria@email.com&#10;João Souza&#10;Ana Lima, ana@email.com, ACME, Diretora"></textarea>
    </div>
    <div class="field" style="text-align:left">
      <label>Marcar todos como</label>
      <div class="edit-presence">
        <label class="ep on"><input type="radio" name="bulk_resp" value="confirmado" checked/> Confirmado</label>
        <label class="ep"><input type="radio" name="bulk_resp" value="recusado"/> Recusado</label>
      </div>
    </div>
    <p class="error-msg hidden" id="bulk_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveBulk()">Incluir lista</button>
    </div>`);
  document.querySelectorAll('.edit-presence .ep').forEach((lab) => {
    lab.addEventListener('click', () => {
      document.querySelectorAll('.edit-presence .ep').forEach((x) => x.classList.remove('on'));
      lab.classList.add('on');
    });
  });
}
async function saveBulk() {
  const text = document.getElementById('bulk_text').value;
  const err = document.getElementById('bulk_err');
  if (!text.trim()) { err.textContent = 'Cole ao menos um nome.'; err.classList.remove('hidden'); return; }
  const response = document.querySelector('input[name="bulk_resp"]:checked').value;
  try {
    const r = await Api.post(`/api/events/${ID}/participants/bulk`, { text, response });
    closeModal();
    toast(`${r.added} incluído(s)${r.skipped_count ? `, ${r.skipped_count} já existia(m)` : ''}.`);
    loadParticipants();
  } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

(async () => { await loadEvent(); await loadParticipants(); })().catch((e) => toast(e.message));
