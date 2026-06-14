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
  renderQuickSummary(data.stats);
  renderStats(data.stats);
  renderRows(data.participants);
}

function deadlineTag() {
  if (EVENT.status !== 'ativo') return '<span class="deadline-tag deadline-red">Evento inativo</span>';
  if (!EVENT.rsvp_deadline) return '<span class="deadline-tag deadline-green">Sem prazo definido</span>';
  const end = new Date(`${EVENT.rsvp_deadline}T23:59:59`).getTime();
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (Date.now() > end) {
    return EVENT.force_open
      ? '<span class="deadline-tag deadline-amber">Reaberto (prazo vencido)</span>'
      : '<span class="deadline-tag deadline-red">Prazo encerrado</span>';
  }
  if (days <= 7) return `<span class="deadline-tag deadline-amber">Faltam ${days} dia(s)</span>`;
  return '<span class="deadline-tag deadline-green">Prazo aberto</span>';
}

function renderQuickSummary(s) {
  const rate = s.expected_guests > 0 ? Math.round((s.total / s.expected_guests) * 100) + '%' : '—';
  document.getElementById('quickSummary').innerHTML = `
    <div class="quick-summary">
      <div class="qs"><span class="k">Data</span><span class="v">${EVENT.event_date ? fmtDateBR(EVENT.event_date) : 'A definir'}${EVENT.event_time ? ' · ' + EVENT.event_time : ''}</span></div>
      <div class="qs"><span class="k">Local</span><span class="v">${esc(EVENT.location) || '—'}</span></div>
      <div class="qs"><span class="k">Convidados esperados</span><span class="v">${EVENT.expected_guests || '—'}</span></div>
      <div class="qs"><span class="k">Taxa de resposta</span><span class="v">${rate}</span></div>
      <div class="qs"><span class="k">Prazo</span><span class="v">${deadlineTag()}</span></div>
    </div>
    <div class="qs-link">
      <div style="flex:1;min-width:200px">
        <span class="k" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600">Link público</span>
        <div class="break-anywhere" style="font-size:13.5px;color:var(--navy);font-weight:500">${esc(EVENT.public_url)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-accent btn-sm" onclick="copyLink()">Copiar link</button>
        <button class="btn btn-ghost btn-sm" onclick="openQr()">QR Code</button>
      </div>
    </div>`;
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
    tb.innerHTML = `<tr><td colspan="4" class="muted center" style="padding:30px">Nenhuma resposta encontrada${state.q || state.filter ? ' com os filtros aplicados' : ' ainda'}.</td></tr>`;
    return;
  }
  tb.innerHTML = list.map((p) => {
    const wa = guestWa(p.phone);
    const sub = [p.company, p.phone, p.email].filter(Boolean).map(esc).join(' · ');
    const icon = (svg, label, attrs) => `<button class="icon-btn" title="${label}" aria-label="${label}" ${attrs}>${svg}</button>`;
    return `
    <tr>
      <td class="row-name" style="display:block">
        <div class="p-name">${esc(p.name)}</div>
        ${sub ? `<div class="p-sub muted break-anywhere">${sub}</div>` : ''}
      </td>
      <td data-label="Status"><span class="pill ${p.response === 'confirmado' ? 'pill-ok' : 'pill-no'}">${p.response === 'confirmado' ? 'Confirmado' : 'Recusado'}</span></td>
      <td data-label="Resposta" style="white-space:nowrap;font-variant-numeric:tabular-nums">${fmtDateTimeBR(p.updated_at)}</td>
      <td class="cell-actions" style="text-align:right">
        ${icon(IC.edit, 'Editar', `onclick="editParticipant(${p.id})"`)}
        ${icon(IC.history, 'Histórico', `onclick="showAudit(${p.id})"`)}
        ${wa ? `<a class="icon-btn icon-wa" title="WhatsApp" aria-label="WhatsApp" href="${wa}" target="_blank" rel="noopener">${IC.wa}</a>` : ''}
        ${icon(IC.trash, 'Remover', `onclick="deleteParticipant(${p.id})"`)}
      </td>
    </tr>`;
  }).join('');
}

// Ícones (SVG) para as ações
const IC = {
  edit: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  history: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.6-1.4-3.7-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 1.8.8 2.5.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
};

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
        <label class="ep ep-yes ${yes ? 'on' : ''}"><input type="radio" name="ed_resp" value="confirmado" ${yes ? 'checked' : ''}/> Confirmado</label>
        <label class="ep ep-no ${!yes ? 'on' : ''}"><input type="radio" name="ed_resp" value="recusado" ${!yes ? 'checked' : ''}/> Recusado</label>
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
  const prev = LAST_LIST.find((x) => x.id === pid);
  const oldResp = prev ? prev.response : null;
  const newResp = document.querySelector('input[name="ed_resp"]:checked').value;
  const payload = {
    name: val('ed_name'), company: val('ed_company'), role: val('ed_role'),
    email: val('ed_email'), phone: val('ed_phone'), response: newResp,
  };
  try {
    await Api.put(`/api/events/${ID}/participants/${pid}`, payload);
    closeModal();
    await loadParticipants();
    // Se o status mudou, oferece desfazer.
    if (oldResp && oldResp !== newResp) {
      showUndo('Status alterado.', async () => {
        try { await Api.put(`/api/events/${ID}/participants/${pid}`, { response: oldResp }); loadParticipants(); } catch (e) { toast(e.message); }
      });
    } else {
      toast('Participante atualizado.');
    }
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

// ---- Toast com ação "Desfazer" ----
function showUndo(message, onUndo) {
  let el = document.querySelector('.undo-toast');
  if (el) el.remove();
  el = document.createElement('div');
  el.className = 'undo-toast';
  el.innerHTML = `<span>${esc(message)}</span><button>Desfazer</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const hide = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.querySelector('button').addEventListener('click', () => { onUndo(); hide(); });
  el._t = setTimeout(hide, 5000);
}

// ---- Excluir participante com desfazer (a remoção só efetiva após 5s) ----
function deleteParticipant(pid) {
  const p = LAST_LIST.find((x) => x.id === pid);
  if (!p) return;
  let undone = false;
  LAST_LIST = LAST_LIST.filter((x) => x.id !== pid);
  renderRows(LAST_LIST);
  const timer = setTimeout(async () => {
    if (undone) return;
    try { await Api.del(`/api/events/${ID}/participants/${pid}`); } catch (e) { toast(e.message); }
    loadParticipants();
  }, 5000);
  showUndo(`${p.name} removido.`, () => { undone = true; clearTimeout(timer); loadParticipants(); });
}

// ---- Duplicar evento ----
document.getElementById('dupBtn').addEventListener('click', async () => {
  if (!confirm('Duplicar este evento? Será criada uma cópia com as mesmas configurações, sem os participantes.')) return;
  try { const novo = await Api.post(`/api/events/${ID}/duplicate`); toast('Evento duplicado.'); location.href = `/admin/event-form.html?id=${novo.id}`; }
  catch (e) { toast(e.message); }
});

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

// ---- Copiar link e abrir QR (chamados pelos botões do resumo) ----
async function copyLink() {
  try { await navigator.clipboard.writeText(EVENT.public_url); toast('Link copiado.'); }
  catch { toast('Copie manualmente: ' + EVENT.public_url); }
}
function openQr() {
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
}
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
        <label class="ep ep-yes on"><input type="radio" name="ao_resp" value="confirmado" checked/> Confirmado</label>
        <label class="ep ep-no"><input type="radio" name="ao_resp" value="recusado"/> Recusado</label>
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
  // Enter no campo de nome dá entrada no registro (atalho de produtividade).
  ['ao_name', 'ao_company', 'ao_role', 'ao_email', 'ao_phone'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveOne(); } });
  });
  document.getElementById('ao_name').focus();
}
async function saveOne(force) {
  const v = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('ao_err');
  if (!v('ao_name')) { err.textContent = 'Informe o nome.'; err.classList.remove('hidden'); return; }
  const payload = {
    name: v('ao_name'), company: v('ao_company'), role: v('ao_role'),
    email: v('ao_email'), phone: v('ao_phone'),
    response: document.querySelector('input[name="ao_resp"]:checked').value,
  };
  if (force) payload.force_update = true;
  try {
    const r = await Api.post(`/api/events/${ID}/participants`, payload);
    closeModal();
    toast(r.updated ? 'Cadastro atualizado.' : 'Participante adicionado.');
    loadParticipants();
  } catch (e) {
    // Possível duplicado: o backend devolve 409 com a mensagem; oferecemos atualizar.
    if (/já existe/i.test(e.message)) {
      if (confirm(e.message)) { saveOne(true); return; }
      return;
    }
    err.textContent = e.message; err.classList.remove('hidden');
  }
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
        <label class="ep ep-yes on"><input type="radio" name="bulk_resp" value="confirmado" checked/> Confirmado</label>
        <label class="ep ep-no"><input type="radio" name="bulk_resp" value="recusado"/> Recusado</label>
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
document.getElementById('refreshSlot').appendChild(refreshButton(loadParticipants, 'Atualizar lista'));
