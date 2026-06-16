requireSession();
const params = new URLSearchParams(location.search);
const eventId = params.get('id');
if (!eventId) location.href = '/admin/events.html';

mountShell('events');

let eventData = null;
let suppliersCache = [];

// ── Abas ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-bar button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-bar button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Status Pills ──────────────────────────────────────────────────────────────
function statusPill(s) {
  const map = { 'Planejamento': '', 'Contratação': 'pill-active', 'Produção': 'pill-ok', 'Evento realizado': 'pill-ok', 'Encerrado': '' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
}
function contractStatusPill(s) {
  const map = { 'Em negociação': '', 'Aguardando aprovação': 'pill-active', 'Aprovado': 'pill-ok', 'Contratado': 'pill-ok', 'Recusado': 'pill-no', 'Cancelado': '' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
}
function priorityPill(p) {
  const map = { 'Baixa': '', 'Média': 'pill-active', 'Alta': '', 'Crítica': 'pill-no' };
  const colors = { 'Alta': 'background:#f97316;color:#fff', 'Baixa': '' };
  return `<span class="pill ${map[p] || ''}" style="${colors[p] || ''}">${esc(p || 'Média')}</span>`;
}
function paymentPill(s) {
  const map = { 'Pendente': 'pill-no', 'Parcial': '', 'Pago': 'pill-ok' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
}
function taskStatusPill(s) {
  const map = { 'Pendente': 'pill-no', 'Em andamento': 'pill-active', 'Concluído': 'pill-ok' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
}

function fmtMoney(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Carregamento principal ────────────────────────────────────────────────────
async function load() {
  const d = await Api.get(`/api/events/${eventId}`);
  eventData = d;

  const ev = d.event;
  document.title = `${ev.name} — Moura One`;
  document.getElementById('eventName').textContent    = ev.name;
  document.getElementById('eventClient').textContent  = ev.client || 'Evento';
  document.getElementById('eventStatusPill').innerHTML = statusPill(ev.status);
  document.getElementById('editEventBtn').href = `/admin/event-form.html?id=${eventId}`;

  renderOverview(ev, d.totalValue);
  renderContracts(d.contracts, d.totalValue);
  renderChecklist(d.checklist);
  renderFiles(d.files);
  renderDiary(d.diary);
  renderTimeline(d);
  loadCover(ev.cover_image);
  showIntegrationsTab(ev);
}

// ── Linha do tempo (montada a partir dos dados já carregados) ─────────────────
function renderTimeline(d) {
  const ev = d.event;
  const items = [];
  if (ev.created_at) items.push({ date: ev.created_at, ico: '🎬', text: 'Evento criado' });
  (d.checklist || []).forEach((t) => {
    if (t.created_at) items.push({ date: t.created_at, ico: '➕', text: `Tarefa criada: <strong>${esc(t.title)}</strong>` });
    if (t.status === 'Concluído' && t.updated_at) items.push({ date: t.updated_at, ico: '✅', text: `Tarefa concluída: <strong>${esc(t.title)}</strong>` });
  });
  (d.contracts || []).forEach((c) => {
    if (c.created_at) items.push({ date: c.created_at, ico: '🤝', text: `Contratação: <strong>${esc(c.company)}</strong>${c.value ? ' — ' + fmtMoney(c.value) : ''}` });
  });
  (d.files || []).forEach((f) => {
    if (f.created_at) items.push({ date: f.created_at, ico: '📎', text: `Arquivo enviado: <strong>${esc(f.filename)}</strong>` });
  });
  (d.diary || []).forEach((e) => {
    if (e.created_at) items.push({ date: e.created_at, ico: '📝', text: `Diário: ${esc((e.entry || '').slice(0, 80))}${(e.entry || '').length > 80 ? '…' : ''}` });
  });

  items.sort((a, b) => (a.date < b.date ? 1 : -1)); // mais recente primeiro

  const el = document.getElementById('timelineList');
  if (!items.length) { el.innerHTML = '<p class="muted">Sem atividade registrada ainda.</p>'; return; }

  let html = ''; let lastDay = '';
  for (const it of items) {
    const day = fmtDateBR(it.date.slice(0, 10));
    if (day !== lastDay) { html += `<div class="tl-day">${day}</div>`; lastDay = day; }
    const time = fmtDateTimeBR(it.date).split(' ').pop();
    html += `<div class="tl-item"><div class="tl-ico">${it.ico}</div><div class="tl-body"><div class="tl-text">${it.text}</div><div class="tl-time">${time}</div></div></div>`;
  }
  el.innerHTML = html;
}

// ── Imagem de capa ────────────────────────────────────────────────────────────
const canEditEvent = () => ['admin', 'gestor'].includes(currentRole());

async function loadCover(hasCover) {
  const area = document.getElementById('coverArea');
  if (hasCover) {
    try {
      const res = await fetch(`/api/events/${eventId}/files/cover`, { headers: { Authorization: `Bearer ${Api.token()}` } });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        area.innerHTML = `<div class="cover-area"><img src="${url}" alt="Capa do evento" /></div>
          ${canEditEvent() ? `<div class="cover-actions">
            <button class="btn btn-ghost btn-sm" id="changeCoverBtn">Trocar capa</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" id="removeCoverBtn">Remover capa</button>
          </div>` : ''}`;
        if (canEditEvent()) {
          document.getElementById('changeCoverBtn').onclick = () => document.getElementById('coverInput').click();
          document.getElementById('removeCoverBtn').onclick = removeCover;
        }
        return;
      }
    } catch { /* cai para o estado vazio */ }
  }
  area.innerHTML = canEditEvent()
    ? `<div class="cover-empty" id="addCoverBtn">🖼️ Adicionar imagem de capa
        <div style="font-size:12px;margin-top:4px">Tamanho ideal: <strong>1200 × 400 px</strong> (proporção 3:1, horizontal)</div>
        <div style="font-size:12px;margin-top:2px">JPG, PNG ou WebP · até 20 MB</div></div>`
    : '';
  const add = document.getElementById('addCoverBtn');
  if (add) add.onclick = () => document.getElementById('coverInput').click();
}

document.getElementById('coverInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('cover', file);
  try {
    await Api.postForm(`/api/events/${eventId}/files/cover`, fd);
    toast('Capa atualizada.');
    document.getElementById('coverInput').value = '';
    await load();
  } catch (err) { toast(err.message); }
});

async function removeCover() {
  if (!confirm('Remover a imagem de capa?')) return;
  try {
    await Api.del(`/api/events/${eventId}/files/cover`);
    toast('Capa removida.');
    await load();
  } catch (e) { toast(e.message); }
}

// ── Visão Geral ───────────────────────────────────────────────────────────────
function renderOverview(ev, totalValue) {
  const row = (label, val) => val
    ? `<div style="display:flex;gap:16px;padding:10px 0;border-bottom:1px solid var(--gray-soft)"><span class="muted" style="min-width:140px;font-size:13px">${label}</span><span style="font-size:14px">${val}</span></div>`
    : '';

  const d = eventData;
  const today = new Date().toISOString().slice(0, 10);
  const contracts = d.contracts || [];
  const checklist = d.checklist || [];
  const files = d.files || [];

  const pendingPaymentsValue = contracts
    .filter((c) => c.payment_status === 'Pendente')
    .reduce((sum, c) => sum + (c.value || 0), 0);
  const openTasks = checklist.filter((t) => t.status !== 'Concluído').length;
  const overdueTasks = checklist.filter((t) => t.due_date && t.due_date < today && t.status !== 'Concluído').length;

  const statCard = (label, val, danger) =>
    `<div style="background:var(--off-white);border-radius:8px;padding:14px 18px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:${danger ? 'var(--danger)' : 'var(--navy)'}">${val}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${label}</div>
    </div>`;

  document.getElementById('overviewCard').innerHTML = `
    ${row('Tipo', esc(ev.event_type))}
    ${row('Data', ev.event_date ? fmtDateBR(ev.event_date) : null)}
    ${row('Horário', ev.event_time)}
    ${row('Local', esc(ev.location))}
    ${row('Cidade', esc(ev.city))}
    ${row('Responsável', esc(ev.responsible))}
    ${row('Status', statusPill(ev.status))}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-top:20px">
      ${statCard('Contratações', contracts.length)}
      ${statCard('Valor Total', fmtMoney(totalValue))}
      ${statCard('Pagamentos Pendentes', fmtMoney(pendingPaymentsValue), pendingPaymentsValue > 0)}
      ${statCard('Tarefas Abertas', openTasks, openTasks > 0)}
      ${statCard('Tarefas Atrasadas', overdueTasks, overdueTasks > 0)}
      ${statCard('Arquivos', files.length)}
    </div>
    <div style="padding:14px 0 0;color:var(--muted);font-size:12px">Atualizado em ${fmtDateTimeBR(ev.updated_at || ev.created_at)}</div>
  `;
}

// ── Contratações ──────────────────────────────────────────────────────────────
function renderContracts(contracts, total) {
  const count = contracts?.length || 0;
  const badge = document.getElementById('contractsCount');
  if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  document.getElementById('contractsTotal').innerHTML =
    `${count} contratação(ões) · Total: <strong>${fmtMoney(total)}</strong>`;

  const body = document.getElementById('contractsBody');
  if (!count) {
    body.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Nenhuma contratação ainda.</td></tr>';
    return;
  }
  body.innerHTML = contracts.map((c) => `<tr class="contract-row">
    <td><strong>${esc(c.company)}</strong></td>
    <td>${c.category ? `<span class="pill">${esc(c.category)}</span>` : '—'}</td>
    <td style="white-space:nowrap">${fmtMoney(c.value)}</td>
    <td>${contractStatusPill(c.status)}</td>
    <td>${paymentPill(c.payment_status)}</td>
    <td class="muted" style="font-size:12px">${c.payment_due_date ? '📅 ' + fmtDateBR(c.payment_due_date) : '—'}</td>
    <td class="muted" style="font-size:13px">${esc(c.notes || '—')}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-ghost btn-sm" onclick="openEditContract(${c.id})">Editar</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteContract(${c.id})">Remover</button>
    </td>
  </tr>`).join('');
}

// ── Checklist ─────────────────────────────────────────────────────────────────
let checklistFilters = { status: '', priority: '', responsible: '', search: '', sort: '' };

const PRIORITY_ORDER = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };

function renderChecklist(tasks) {
  const open = tasks?.filter((t) => t.status !== 'Concluído').length || 0;
  const badge = document.getElementById('checklistCount');
  if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  let filtered = tasks || [];
  if (checklistFilters.status)      filtered = filtered.filter((t) => t.status === checklistFilters.status);
  if (checklistFilters.priority)    filtered = filtered.filter((t) => (t.priority || 'Média') === checklistFilters.priority);
  if (checklistFilters.responsible) filtered = filtered.filter((t) => (t.responsible || '').toLowerCase().includes(checklistFilters.responsible.toLowerCase()));
  if (checklistFilters.search)      filtered = filtered.filter((t) => (t.title + ' ' + (t.responsible || '') + ' ' + (t.priority || '')).toLowerCase().includes(checklistFilters.search.toLowerCase()));

  if (checklistFilters.sort === 'priority') {
    filtered = [...filtered].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
  } else if (checklistFilters.sort === 'due_date') {
    filtered = [...filtered].sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
  } else if (checklistFilters.sort === 'status') {
    const SO = { 'Pendente': 0, 'Em andamento': 1, 'Concluído': 2 };
    filtered = [...filtered].sort((a, b) => (SO[a.status] ?? 0) - (SO[b.status] ?? 0));
  } else if (checklistFilters.sort === 'responsible') {
    filtered = [...filtered].sort((a, b) => (a.responsible || '').localeCompare(b.responsible || '', 'pt-BR'));
  }

  const el = document.getElementById('checklistList');
  if (!filtered.length) {
    el.innerHTML = '<p class="muted">Nenhuma tarefa encontrada.</p>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = filtered.map((t) => {
    const overdue = t.due_date && t.due_date < today && t.status !== 'Concluído';
    return `
    <div class="checklist-item ${t.status === 'Concluído' ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" class="checklist-check" ${t.status === 'Concluído' ? 'checked' : ''} onchange="toggleTask(${t.id}, this.checked)" />
      <div class="checklist-info" style="flex:1">
        <div class="checklist-title">${esc(t.title)}</div>
        <div class="checklist-meta" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
          ${priorityPill(t.priority || 'Média')}
          ${t.responsible ? `<span class="pill">👤 ${esc(t.responsible)}</span>` : ''}
          ${t.due_date ? `<span class="pill ${overdue ? 'pill-no' : ''}">📅 ${fmtDateBR(t.due_date)}${overdue ? ' ⚠️' : ''}</span>` : ''}
          ${taskStatusPill(t.status)}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="openTaskComments(${t.id})">💬</button>
        <button class="btn btn-ghost btn-sm" onclick="openEditTask(${t.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteTask(${t.id})">✕</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('checklistFilter').addEventListener('change', (e) => {
  checklistFilters.status = e.target.value;
  renderChecklist(eventData?.checklist);
});

let commentTid = null;
let commentCache = [];

function commentBlock(c, isReply) {
  return `
    <div style="padding:9px 10px;background:${isReply ? 'var(--gray-soft)' : 'var(--off-white)'};border-radius:6px;margin-bottom:6px;${isReply ? 'margin-left:22px' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
        <strong style="font-size:13px">${esc(c.author || '?')}</strong>
        <span style="font-size:12px;color:var(--muted)">${fmtDateTimeBR(c.created_at)}${c.updated_at ? ' · editado' : ''}</span>
      </div>
      <div style="font-size:14px" class="rich" id="ctext-${c.id}">${renderRich(c.comment)}</div>
      <div style="display:flex;gap:10px;margin-top:5px">
        ${!isReply ? `<button class="btn-link-sm" onclick="replyComment(${c.id})">Responder</button>` : ''}
        <button class="btn-link-sm" onclick="editComment(${c.id})">Editar</button>
        <button class="btn-link-sm" style="color:var(--danger)" onclick="deleteComment(${c.id})">Excluir</button>
      </div>
      <div id="creply-${c.id}"></div>
    </div>`;
}

function renderComments() {
  const list = document.getElementById('commentsList');
  if (!commentCache.length) { list.innerHTML = '<p class="muted">Nenhum comentário ainda.</p>'; return; }
  const parents = commentCache.filter((c) => !c.parent_id);
  const repliesOf = (pid) => commentCache.filter((c) => c.parent_id === pid);
  list.innerHTML = parents.map((p) => commentBlock(p, false) + repliesOf(p.id).map((r) => commentBlock(r, true)).join('')).join('');
}

async function openTaskComments(tid) {
  const task = eventData.checklist.find((t) => t.id === tid);
  if (!task) return;
  commentTid = tid;
  commentCache = await Api.get(`/api/events/${eventId}/checklist/${tid}/comments`);
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:520px">
        <h3 style="margin-bottom:4px;font-size:16px">${esc(task.title)}</h3>
        <div style="color:var(--muted);font-size:13px;margin-bottom:16px">Comentários da tarefa</div>
        <div id="commentsList" style="max-height:300px;overflow-y:auto;margin-bottom:16px"></div>
        ${formatToolbar('newComment')}
        <textarea id="newComment" placeholder="Escreva um comentário..." style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit;min-height:64px;margin-bottom:12px"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button>
          <button class="btn btn-primary btn-sm" onclick="saveComment()">Comentar</button>
        </div>
      </div>
    </div>`;
  renderComments();
}

async function refreshComments() {
  commentCache = await Api.get(`/api/events/${eventId}/checklist/${commentTid}/comments`);
  renderComments();
}

async function saveComment() {
  const comment = document.getElementById('newComment').value.trim();
  if (!comment) { toast('Escreva um comentário.'); return; }
  await Api.post(`/api/events/${eventId}/checklist/${commentTid}/comments`, { comment });
  document.getElementById('newComment').value = '';
  await refreshComments();
  toast('Comentário adicionado.');
}

function replyComment(cid) {
  const slot = document.getElementById(`creply-${cid}`);
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div style="margin:6px 0 0 22px">
      <textarea id="replyText-${cid}" placeholder="Responder…" style="width:100%;padding:6px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit;min-height:48px"></textarea>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('creply-${cid}').innerHTML=''">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="sendReply(${cid})">Responder</button>
      </div>
    </div>`;
  document.getElementById(`replyText-${cid}`).focus();
}

async function sendReply(cid) {
  const text = document.getElementById(`replyText-${cid}`).value.trim();
  if (!text) { toast('Escreva a resposta.'); return; }
  await Api.post(`/api/events/${eventId}/checklist/${commentTid}/comments`, { comment: text, parent_id: cid });
  await refreshComments();
}

function editComment(cid) {
  const c = commentCache.find((x) => x.id === cid);
  if (!c) return;
  const box = document.getElementById(`ctext-${cid}`);
  box.innerHTML = `
    <textarea id="editC-${cid}" style="width:100%;padding:6px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit;min-height:48px">${esc(c.comment)}</textarea>
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-ghost btn-sm" onclick="renderComments()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveCommentEdit(${cid})">Salvar</button>
    </div>`;
  document.getElementById(`editC-${cid}`).focus();
}

async function saveCommentEdit(cid) {
  const text = document.getElementById(`editC-${cid}`).value.trim();
  if (!text) { toast('O comentário não pode ficar vazio.'); return; }
  await Api.put(`/api/events/${eventId}/checklist/${commentTid}/comments/${cid}`, { comment: text });
  await refreshComments();
}

async function deleteComment(cid) {
  if (!confirm('Excluir este comentário (e respostas)?')) return;
  await Api.del(`/api/events/${eventId}/checklist/${commentTid}/comments/${cid}`);
  await refreshComments();
}

async function toggleTask(tid, checked) {
  const status = checked ? 'Concluído' : 'Pendente';
  await Api.put(`/api/events/${eventId}/checklist/${tid}`, { status });
  await load();
}

// ── Arquivos ──────────────────────────────────────────────────────────────────
let fileFilter = '';
let fileSearchQuery = '';

function renderFiles(files) {
  const el = document.getElementById('fileList');
  let filtered = files || [];
  if (fileFilter)      filtered = filtered.filter((f) => (f.category || 'Outros') === fileFilter);
  if (fileSearchQuery) filtered = filtered.filter((f) => (f.filename || '').toLowerCase().includes(fileSearchQuery.toLowerCase()));
  if (!filtered.length) { el.innerHTML = '<p class="muted">Nenhum arquivo encontrado.</p>'; return; }
  el.innerHTML = filtered.map((f) => {
    const canView = (f.mime_type || '').startsWith('image/') && f.mime_type !== 'image/svg+xml' || f.mime_type === 'application/pdf';
    return `
    <div class="file-row">
      <div class="file-icon">${fileIcon(f.mime_type)}</div>
      <div class="file-info">
        <div class="file-name">${esc(f.filename)}</div>
        <div class="file-meta">
          <span class="pill" style="font-size:11px">${esc(f.category || 'Outros')}</span>
          ${fmtSize(f.size)} · ${esc(f.uploaded_by || '?')} · ${fmtDateTimeBR(f.created_at)}
        </div>
      </div>
      ${canView ? `<button class="btn btn-ghost btn-sm" onclick="viewFile(${f.id}, '${esc(f.mime_type)}')">Visualizar</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="downloadFile(${f.id}, '${esc(f.filename).replace(/'/g,"\\'")}')">Baixar</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteFile(${f.id})">✕</button>
    </div>`;
  }).join('');
}

// Pré-visualiza um arquivo (imagem/PDF) buscando com token e abrindo como blob.
async function viewFile(fid, mime) {
  try {
    const res = await fetch(`/api/events/${eventId}/files/${fid}/view`, { headers: { Authorization: `Bearer ${Api.token()}` } });
    if (!res.ok) { toast('Não foi possível abrir o arquivo.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if ((mime || '').startsWith('image/')) {
      document.getElementById('modalSlot').innerHTML = `
        <div class="modal-bg" onclick="if(event.target===this){closeModal();URL.revokeObjectURL('${url}')}">
          <div class="modal" style="max-width:90vw;width:auto;padding:14px">
            <img src="${url}" alt="Pré-visualização" style="max-width:86vw;max-height:80vh;border-radius:8px" />
            <div style="margin-top:10px;text-align:right"><button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button></div>
          </div>
        </div>`;
    } else {
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch { toast('Não foi possível abrir o arquivo.'); }
}

document.getElementById('fileFilter')?.addEventListener('change', (e) => {
  fileFilter = e.target.value;
  renderFiles(eventData?.files);
});

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/'))       return '🖼️';
  if (mime === 'application/pdf')      return '📕';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('word'))           return '📝';
  if (mime.includes('zip') || mime.includes('rar')) return '🗜️';
  return '📄';
}

// Upload via drag-and-drop e click
const dropZone   = document.getElementById('dropZone');
const fileInput  = document.getElementById('fileInput');
document.getElementById('browseFiles').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(files) {
  const cat = document.getElementById('fileCategory')?.value || 'Outros';
  for (const file of Array.from(files)) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', cat);
    try {
      await Api.postForm(`/api/events/${eventId}/files`, fd);
      toast(`${file.name} enviado.`);
    } catch (e) {
      toast(e.message);
    }
  }
  fileInput.value = '';
  await load();
}

async function downloadFile(fid, filename) {
  try {
    const res = await fetch(`/api/events/${eventId}/files/${fid}/download`, {
      headers: { Authorization: `Bearer ${Api.token()}` },
    });
    if (!res.ok) { toast('Erro ao baixar arquivo.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast('Erro ao baixar arquivo.'); }
}

async function deleteFile(fid) {
  if (!confirm('Remover este arquivo?')) return;
  await Api.del(`/api/events/${eventId}/files/${fid}`);
  await load();
}

// ── Diário ────────────────────────────────────────────────────────────────────
let diarySearch = '';

function renderDiary(entries) {
  const el = document.getElementById('diaryList');
  let filtered = entries || [];
  if (diarySearch) filtered = filtered.filter((e) => e.entry.toLowerCase().includes(diarySearch) || (e.author || '').toLowerCase().includes(diarySearch));
  if (!filtered.length) { el.innerHTML = '<p class="muted">Nenhum registro encontrado.</p>'; return; }
  el.innerHTML = filtered.map((e) => `
    <div class="diary-entry" id="diary-${e.id}">
      <div class="diary-meta">${fmtDateTimeBR(e.created_at)} · <strong>${esc(e.author || '?')}</strong>${e.updated_at ? ' · <em>editado</em>' : ''}</div>
      <div class="diary-text rich" style="margin-top:6px">${renderRich(e.entry)}</div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="editDiary(${e.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteDiary(${e.id})">Remover</button>
      </div>
    </div>
  `).join('');
}

function editDiary(did) {
  const entry = eventData.diary.find((d) => d.id === did);
  if (!entry) return;
  const box = document.getElementById(`diary-${did}`);
  box.innerHTML = `
    ${formatToolbar('editDiaryText')}
    <textarea id="editDiaryText" rows="3" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit">${esc(entry.entry)}</textarea>
    <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="renderDiary(eventData.diary)">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveDiaryEdit(${did})">Salvar</button>
    </div>`;
  document.getElementById('editDiaryText').focus();
}

async function saveDiaryEdit(did) {
  const text = document.getElementById('editDiaryText').value.trim();
  if (!text) { toast('O registro não pode ficar vazio.'); return; }
  try {
    await Api.put(`/api/events/${eventId}/diary/${did}`, { entry: text });
    toast('Registro atualizado.');
    await load();
  } catch (e) { toast(e.message); }
}

document.getElementById('diarySearchInput')?.addEventListener('input', (e) => {
  diarySearch = e.target.value.toLowerCase().trim();
  renderDiary(eventData?.diary);
});

document.getElementById('exportDiaryBtn')?.addEventListener('click', () => {
  const ev = eventData?.event;
  const entries = eventData?.diary || [];
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Diário — ${esc(ev?.name || '')}</title>
  <style>body{font-family:sans-serif;max-width:800px;margin:40px auto;color:#222}h1{font-size:22px;margin-bottom:4px}p.sub{color:#666;font-size:13px;margin-bottom:32px}.entry{border-bottom:1px solid #eee;padding:16px 0}.meta{font-size:12px;color:#888;margin-bottom:6px}.text{font-size:15px;white-space:pre-wrap}@media print{body{margin:20px}}</style>
  </head><body>
  <h1>Diário do Evento — ${esc(ev?.name || '')}</h1>
  <p class="sub">${ev?.client || ''} · Exportado em ${new Date().toLocaleDateString('pt-BR')}</p>
  ${entries.map((e) => `<div class="entry"><div class="meta">${fmtDateTimeBR(e.created_at)} · ${esc(e.author || '?')}</div><div class="text">${esc(e.entry)}</div></div>`).join('')}
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.print();
});

document.getElementById('saveDiaryBtn').addEventListener('click', async () => {
  const entry = document.getElementById('diaryEntry').value.trim();
  if (!entry) return;
  try {
    await Api.post(`/api/events/${eventId}/diary`, { entry });
    document.getElementById('diaryEntry').value = '';
    toast('Registro salvo.');
    await load();
  } catch (e) { toast(e.message); }
});

async function deleteDiary(did) {
  if (!confirm('Remover este registro?')) return;
  await Api.del(`/api/events/${eventId}/diary/${did}`);
  await load();
}

// ── Modal: Adicionar/Editar Contratação ───────────────────────────────────────
async function loadSuppliers() {
  if (!suppliersCache.length) suppliersCache = await Api.get('/api/suppliers');
  return suppliersCache;
}

async function openAddContract() {
  const suppliers = await loadSuppliers();
  showContractModal(null, suppliers);
}

async function openEditContract(cid) {
  const suppliers = await loadSuppliers();
  const c = eventData.contracts.find((x) => x.id === cid);
  showContractModal(c, suppliers);
}

function showContractModal(contract, suppliers) {
  const isEdit = !!contract;
  const opts = suppliers.map((s) =>
    `<option value="${s.id}" ${contract?.supplier_id === s.id ? 'selected' : ''}>${esc(s.company)}${s.category ? ' (' + esc(s.category) + ')' : ''}</option>`
  ).join('');

  const CONTRACT_STATUSES = ['Em negociação','Aguardando aprovação','Aprovado','Contratado','Recusado','Cancelado'];

  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" id="contractModal">
      <div class="modal">
        <h2>${isEdit ? 'Editar contratação' : 'Adicionar contratação'}</h2>
        ${!isEdit ? `<div class="field"><label>Fornecedor *</label><select id="mSupplier"><option value="">Selecione…</option>${opts}</select></div>` : `<p style="font-weight:600;margin-bottom:16px">${esc(contract.company)}</p>`}
        <div class="field"><label>Valor (R$)</label><input type="number" id="mValue" step="0.01" min="0" value="${contract?.value ?? ''}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Status</label>
            <select id="mStatus">
              ${CONTRACT_STATUSES.map((s) => `<option ${contract?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Pagamento</label>
            <select id="mPayment">
              ${['Pendente','Parcial','Pago'].map((s) => `<option ${contract?.payment_status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label>Data de pagamento</label><input type="date" id="mPaymentDue" value="${contract?.payment_due_date || ''}" /></div>
        <div class="field"><label>Observações</label><textarea id="mNotes" rows="2">${esc(contract?.notes || '')}</textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="mSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;

  document.getElementById('mSaveBtn').addEventListener('click', async () => {
    const body = {
      value:            document.getElementById('mValue').value || null,
      status:           document.getElementById('mStatus').value,
      payment_status:   document.getElementById('mPayment').value,
      payment_due_date: document.getElementById('mPaymentDue').value || null,
      notes:            document.getElementById('mNotes').value.trim() || null,
    };
    if (!isEdit) body.supplier_id = document.getElementById('mSupplier').value;
    if (!isEdit && !body.supplier_id) { toast('Selecione um fornecedor.'); return; }
    try {
      if (isEdit) await Api.put(`/api/events/${eventId}/contracts/${contract.id}`, body);
      else        await Api.post(`/api/events/${eventId}/contracts`, body);
      closeModal();
      toast('Contratação salva.');
      await load();
    } catch (e) { toast(e.message); }
  });
}

async function deleteContract(cid) {
  if (!confirm('Remover esta contratação?')) return;
  await Api.del(`/api/events/${eventId}/contracts/${cid}`);
  toast('Contratação removida.');
  await load();
}

// ── Modal: Tarefa ─────────────────────────────────────────────────────────────
function openAddTask()    { showTaskModal(null); }
function openEditTask(tid) { showTaskModal(eventData.checklist.find((t) => t.id === tid)); }

function showTaskModal(task) {
  const isEdit = !!task;
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" id="taskModal">
      <div class="modal">
        <h2>${isEdit ? 'Editar tarefa' : 'Nova tarefa'}</h2>
        <div class="field"><label>Título *</label><input type="text" id="tTitle" value="${esc(task?.title || '')}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Responsável</label><input type="text" id="tResp" value="${esc(task?.responsible || '')}" /></div>
          <div class="field"><label>Prazo</label><input type="date" id="tDate" value="${task?.due_date || ''}" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Status</label>
            <select id="tStatus">
              ${['Pendente','Em andamento','Concluído'].map((s) => `<option ${task?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Prioridade</label>
            <select id="tPriority">
              ${['Baixa','Média','Alta','Crítica'].map((p) => `<option ${(task?.priority || 'Média') === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="tSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;

  document.getElementById('tSaveBtn').addEventListener('click', async () => {
    const title = document.getElementById('tTitle').value.trim();
    if (!title) { toast('Informe o título.'); return; }
    const body = {
      title,
      responsible: document.getElementById('tResp').value.trim() || null,
      due_date:    document.getElementById('tDate').value || null,
      status:      document.getElementById('tStatus').value,
      priority:    document.getElementById('tPriority').value,
    };
    try {
      if (isEdit) await Api.put(`/api/events/${eventId}/checklist/${task.id}`, body);
      else        await Api.post(`/api/events/${eventId}/checklist`, body);
      closeModal();
      toast('Tarefa salva.');
      await load();
    } catch (e) { toast(e.message); }
  });
}

async function deleteTask(tid) {
  if (!confirm('Remover esta tarefa?')) return;
  await Api.del(`/api/events/${eventId}/checklist/${tid}`);
  await load();
}

function closeModal() {
  document.getElementById('modalSlot').innerHTML = '';
}

// Botões de adicionar
document.getElementById('addContractBtn').addEventListener('click', openAddContract);
document.getElementById('addTaskBtn').addEventListener('click', openAddTask);

// Gerar tarefas do modelo (tipo do evento)
document.getElementById('applyTemplateBtn').addEventListener('click', async () => {
  const tipo = eventData?.event?.event_type;
  if (!tipo) { toast('Defina o tipo do evento (em Editar) para gerar as tarefas do modelo.'); return; }
  if (!confirm(`Gerar as tarefas padrão do tipo "${tipo}"? Elas serão adicionadas ao checklist atual.`)) return;
  try {
    const r = await Api.post(`/api/events/${eventId}/apply-template`, {});
    toast(`${r.added} tarefa(s) adicionada(s).`);
    await load();
  } catch (e) { toast(e.message); }
});

// Duplicar evento
document.getElementById('duplicateBtn').addEventListener('click', async () => {
  if (!confirm('Duplicar este evento? Será criada uma cópia em Planejamento com o mesmo checklist (tarefas zeradas).')) return;
  try {
    const novo = await Api.post(`/api/events/${eventId}/duplicate`, {});
    toast('Evento duplicado.');
    setTimeout(() => location.href = `/admin/event-detail.html?id=${novo.id}`, 500);
  } catch (e) { toast(e.message); }
});

// Exportar relatório completo do evento em PDF (via janela de impressão)
document.getElementById('exportPdfBtn').addEventListener('click', () => {
  const d = eventData;
  if (!d) return;
  const ev = d.event;
  const contracts = d.contracts || [];
  const checklist = d.checklist || [];
  const diary = d.diary || [];
  const total = contracts.reduce((s, c) => s + (c.value || 0), 0);
  const pago = contracts.filter((c) => c.payment_status === 'Pago').reduce((s, c) => s + (c.value || 0), 0);
  const pend = total - pago;

  const row = (k, v) => v ? `<tr><td class="k">${k}</td><td>${esc(v)}</td></tr>` : '';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(ev.name)} — Moura One</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1A1F2B;max-width:820px;margin:32px auto;padding:0 20px}
    .brand{font-size:24px;font-weight:800;letter-spacing:-.02em;color:#0E1B3D}.brand i{color:#00C2B8;font-style:normal}
    .tag{color:#64748B;font-size:12px;margin-bottom:18px}
    h1{font-size:22px;margin:14px 0 2px;color:#152C6B}h2{font-size:15px;margin:26px 0 8px;color:#152C6B;border-bottom:2px solid #00C2B8;padding-bottom:4px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
    td,th{padding:7px 9px;border-bottom:1px solid #E2E8F0;text-align:left;vertical-align:top}
    th{font-size:11px;text-transform:uppercase;color:#64748B;letter-spacing:.04em}
    td.k{color:#64748B;width:160px}
    .fin{display:flex;gap:10px;margin:8px 0}.fin div{flex:1;background:#F1F5F9;border-radius:8px;padding:10px 12px}
    .fin .n{font-size:17px;font-weight:700;color:#152C6B}.fin .l{font-size:11px;color:#64748B}
    .diary p{white-space:pre-wrap;font-size:13px;margin:0}.diary .m{font-size:11px;color:#64748B;margin:10px 0 2px}
    @media print{body{margin:12px auto}}
  </style></head><body>
  <div class="brand">moura <i>one</i></div>
  <div class="tag">Plataforma de Operações e Eventos · Relatório do Evento</div>
  <h1>${esc(ev.name)}</h1>
  <table>
    ${row('Cliente', ev.client)}${row('Tipo', ev.event_type)}
    ${row('Data', ev.event_date ? fmtDateBR(ev.event_date) : '')}${row('Horário', ev.event_time)}
    ${row('Local', ev.location)}${row('Cidade', ev.city)}
    ${row('Responsável', ev.responsible)}${row('Status', ev.status)}
  </table>

  <h2>Resumo Financeiro</h2>
  <div class="fin">
    <div><div class="n">${fmtMoney(total)}</div><div class="l">Total contratado</div></div>
    <div><div class="n">${fmtMoney(pago)}</div><div class="l">Pago</div></div>
    <div><div class="n">${fmtMoney(pend)}</div><div class="l">Pendente</div></div>
    <div><div class="n">${contracts.length}</div><div class="l">Contratações</div></div>
  </div>

  <h2>Contratações</h2>
  ${contracts.length ? `<table><thead><tr><th>Fornecedor</th><th>Categoria</th><th>Valor</th><th>Status</th><th>Pagamento</th></tr></thead><tbody>
    ${contracts.map((c) => `<tr><td>${esc(c.company)}</td><td>${esc(c.category || '—')}</td><td>${fmtMoney(c.value)}</td><td>${esc(c.status)}</td><td>${esc(c.payment_status)}</td></tr>`).join('')}
  </tbody></table>` : '<p style="color:#64748B;font-size:13px">Nenhuma contratação.</p>'}

  <h2>Checklist (${checklist.filter((t) => t.status === 'Concluído').length}/${checklist.length} concluídas)</h2>
  ${checklist.length ? `<table><thead><tr><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th>Status</th></tr></thead><tbody>
    ${checklist.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.responsible || '—')}</td><td>${t.due_date ? fmtDateBR(t.due_date) : '—'}</td><td>${esc(t.priority || 'Média')}</td><td>${esc(t.status)}</td></tr>`).join('')}
  </tbody></table>` : '<p style="color:#64748B;font-size:13px">Nenhuma tarefa.</p>'}

  <h2>Diário do Evento</h2>
  ${diary.length ? `<div class="diary">${diary.map((e) => `<div class="m">${fmtDateTimeBR(e.created_at)} · ${esc(e.author || '?')}</div><p>${esc(e.entry)}</p>`).join('')}</div>` : '<p style="color:#64748B;font-size:13px">Nenhum registro.</p>'}

  <p style="margin-top:30px;color:#94A3B8;font-size:11px">Gerado em ${new Date().toLocaleString('pt-BR')} · Moura One</p>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close(); w.print();
});

// Barra de formatação no campo de novo registro do diário.
const diaryFmt = document.getElementById('diaryFmtBar');
if (diaryFmt) diaryFmt.innerHTML = formatToolbar('diaryEntry');

// ── Lote B: dados operacionais (carregados juntos com load) ──────────────────
let approvalsData = [];
let risksData     = [];
let decisionsData = [];
let crisesData    = [];

// ── Centro de Aprovações ─────────────────────────────────────────────────────
function approvalStatusPill(s) {
  const m = { 'Pendente': 'pill-no', 'Aprovado': 'pill-ok', 'Rejeitado': '' };
  return `<span class="pill ${m[s] || ''}">${esc(s)}</span>`;
}
function approvalTypePill(t) {
  return `<span class="pill pill-active">${esc(t)}</span>`;
}

function renderApprovals(rows) {
  approvalsData = rows || [];
  const pending = approvalsData.filter((a) => a.status === 'Pendente').length;
  const badge   = document.getElementById('approvalsCount');
  if (pending > 0) { badge.textContent = pending; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
  document.getElementById('approvalsTotal').textContent = `${approvalsData.length} aprovação(ões)`;

  const el = document.getElementById('approvalsList');
  if (!approvalsData.length) {
    el.innerHTML = '<p class="muted">Nenhuma aprovação registrada.</p>';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Título</th><th>Tipo</th><th>Descrição</th><th>Status</th><th>Aprovado por</th><th>Data</th><th>Observação</th><th></th></tr></thead>
    <tbody>${approvalsData.map((a) => `<tr>
      <td><strong>${esc(a.title)}</strong></td>
      <td>${approvalTypePill(a.type)}</td>
      <td class="muted" style="font-size:13px;max-width:200px">${esc(a.description || '—')}</td>
      <td>${approvalStatusPill(a.status)}</td>
      <td>${esc(a.approved_by || '—')}</td>
      <td class="muted" style="font-size:12px">${a.approved_at ? fmtDateBR(a.approved_at) : '—'}</td>
      <td class="muted" style="font-size:13px">${esc(a.observation || '—')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEditApproval(${a.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteApproval(${a.id})">Remover</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function openAddApproval() { showApprovalModal(null); }
function openEditApproval(id) { showApprovalModal(approvalsData.find((a) => a.id === id)); }

function showApprovalModal(a) {
  const isEdit = !!a;
  const TYPES    = ['Fornecedor', 'Orçamento', 'Mudança', 'Outro'];
  const STATUSES = ['Pendente', 'Aprovado', 'Rejeitado'];
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${isEdit ? 'Editar aprovação' : 'Nova aprovação'}</h2>
        <div class="field"><label>Título *</label><input type="text" id="apTitle" value="${esc(a?.title || '')}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Tipo</label>
            <select id="apType">${TYPES.map((t) => `<option ${(a?.type||'Outro')===t?'selected':''}>${t}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Status</label>
            <select id="apStatus">${STATUSES.map((s) => `<option ${(a?.status||'Pendente')===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Descrição</label><textarea id="apDesc" rows="2">${esc(a?.description || '')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Aprovado por</label><input type="text" id="apBy" value="${esc(a?.approved_by || '')}" /></div>
          <div class="field"><label>Data de aprovação</label><input type="date" id="apAt" value="${a?.approved_at || ''}" /></div>
        </div>
        <div class="field"><label>Observação</label><input type="text" id="apObs" value="${esc(a?.observation || '')}" /></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="apSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('apSaveBtn').addEventListener('click', async () => {
    const title = document.getElementById('apTitle').value.trim();
    if (!title) { toast('Informe o título.'); return; }
    const body = {
      title,
      type:        document.getElementById('apType').value,
      status:      document.getElementById('apStatus').value,
      description: document.getElementById('apDesc').value.trim() || null,
      approved_by: document.getElementById('apBy').value.trim() || null,
      approved_at: document.getElementById('apAt').value || null,
      observation: document.getElementById('apObs').value.trim() || null,
    };
    try {
      if (isEdit) await Api.put(`/api/events/${eventId}/approvals/${a.id}`, body);
      else        await Api.post(`/api/events/${eventId}/approvals`, body);
      closeModal();
      toast('Aprovação salva.');
      await loadOperational();
    } catch (e) { toast(e.message); }
  });
}

async function deleteApproval(id) {
  if (!confirm('Remover esta aprovação?')) return;
  await Api.del(`/api/events/${eventId}/approvals/${id}`);
  await loadOperational();
}

// ── Riscos do Evento ─────────────────────────────────────────────────────────
function riskImpactPill(i) {
  const m = { 'Alto': 'pill-no', 'Médio': 'pill-active', 'Baixo': '' };
  return `<span class="pill ${m[i] || ''}">${esc(i)}</span>`;
}
function riskStatusPill(s) {
  const m = { 'Ativo': 'pill-no', 'Mitigado': 'pill-active', 'Encerrado': 'pill-ok' };
  return `<span class="pill ${m[s] || ''}">${esc(s)}</span>`;
}

function renderRisks(rows) {
  risksData = rows || [];
  const active   = risksData.filter((r) => r.status === 'Ativo').length;
  const critical = risksData.filter((r) => r.status === 'Ativo' && r.impact === 'Alto').length;
  const badge    = document.getElementById('risksCount');
  if (active > 0) { badge.textContent = active; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  const totalEl = document.getElementById('risksTotal');
  totalEl.innerHTML = `${risksData.length} risco(s) · <span style="color:var(--danger)">${active} ativo(s)</span>${critical ? ` · <strong style="color:var(--danger)">${critical} crítico(s)</strong>` : ''}`;

  const el = document.getElementById('risksList');
  if (!risksData.length) { el.innerHTML = '<p class="muted">Nenhum risco registrado.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Descrição</th><th>Impacto</th><th>Probabilidade</th><th>Status</th><th>Plano de ação</th><th></th></tr></thead>
    <tbody>${risksData.map((r) => `<tr>
      <td><strong>${esc(r.description)}</strong></td>
      <td>${riskImpactPill(r.impact)}</td>
      <td><span class="pill">${esc(r.probability)}</span></td>
      <td>${riskStatusPill(r.status)}</td>
      <td class="muted" style="font-size:13px;max-width:220px">${esc(r.action_plan || '—')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEditRisk(${r.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteRisk(${r.id})">Remover</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function openAddRisk() { showRiskModal(null); }
function openEditRisk(id) { showRiskModal(risksData.find((r) => r.id === id)); }

function showRiskModal(r) {
  const isEdit = !!r;
  const IMPACTS = ['Alto', 'Médio', 'Baixo'];
  const PROBS   = ['Alta', 'Média', 'Baixa'];
  const STATS   = ['Ativo', 'Mitigado', 'Encerrado'];
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${isEdit ? 'Editar risco' : 'Novo risco'}</h2>
        <div class="field"><label>Descrição *</label><textarea id="rDesc" rows="2">${esc(r?.description || '')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
          <div class="field"><label>Impacto</label>
            <select id="rImpact">${IMPACTS.map((i) => `<option ${(r?.impact||'Médio')===i?'selected':''}>${i}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Probabilidade</label>
            <select id="rProb">${PROBS.map((p) => `<option ${(r?.probability||'Média')===p?'selected':''}>${p}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Status</label>
            <select id="rStatus">${STATS.map((s) => `<option ${(r?.status||'Ativo')===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Plano de ação</label><textarea id="rPlan" rows="2">${esc(r?.action_plan || '')}</textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="rSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('rSaveBtn').addEventListener('click', async () => {
    const description = document.getElementById('rDesc').value.trim();
    if (!description) { toast('Informe a descrição.'); return; }
    const body = {
      description,
      impact:      document.getElementById('rImpact').value,
      probability: document.getElementById('rProb').value,
      status:      document.getElementById('rStatus').value,
      action_plan: document.getElementById('rPlan').value.trim() || null,
    };
    try {
      if (isEdit) await Api.put(`/api/events/${eventId}/risks/${r.id}`, body);
      else        await Api.post(`/api/events/${eventId}/risks`, body);
      closeModal();
      toast('Risco salvo.');
      await loadOperational();
    } catch (e) { toast(e.message); }
  });
}

async function deleteRisk(id) {
  if (!confirm('Remover este risco?')) return;
  await Api.del(`/api/events/${eventId}/risks/${id}`);
  await loadOperational();
}

// ── Centro de Decisões ───────────────────────────────────────────────────────
function renderDecisions(rows) {
  decisionsData = rows || [];
  document.getElementById('decisionsTotal').textContent = `${decisionsData.length} decisão(ões)`;

  const el = document.getElementById('decisionsList');
  if (!decisionsData.length) { el.innerHTML = '<p class="muted">Nenhuma decisão registrada.</p>'; return; }
  el.innerHTML = decisionsData.map((d) => `
    <div class="diary-entry" style="padding:16px 0">
      <div class="diary-meta">
        ${d.decision_date ? `<strong>${fmtDateBR(d.decision_date)}</strong> · ` : ''}
        ${d.approver ? `Aprovado por <strong>${esc(d.approver)}</strong> · ` : ''}
        Registrado em ${fmtDateTimeBR(d.created_at)}
      </div>
      <div style="margin:8px 0;font-size:15px;font-weight:500">${esc(d.decision)}</div>
      ${d.reason ? `<div style="font-size:13px;color:var(--muted)">Justificativa: ${esc(d.reason)}</div>` : ''}
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="openEditDecision(${d.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteDecision(${d.id})">Remover</button>
      </div>
    </div>`).join('');
}

function openAddDecision() { showDecisionModal(null); }
function openEditDecision(id) { showDecisionModal(decisionsData.find((d) => d.id === id)); }

function showDecisionModal(dec) {
  const isEdit = !!dec;
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${isEdit ? 'Editar decisão' : 'Nova decisão'}</h2>
        <div class="field"><label>Data da decisão</label><input type="date" id="dDate" value="${dec?.decision_date || ''}" /></div>
        <div class="field"><label>Decisão *</label><textarea id="dDecision" rows="3">${esc(dec?.decision || '')}</textarea></div>
        <div class="field"><label>Justificativa</label><textarea id="dReason" rows="2">${esc(dec?.reason || '')}</textarea></div>
        <div class="field"><label>Aprovado por</label><input type="text" id="dApprover" value="${esc(dec?.approver || '')}" /></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="dSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('dSaveBtn').addEventListener('click', async () => {
    const decision = document.getElementById('dDecision').value.trim();
    if (!decision) { toast('Informe a decisão.'); return; }
    const body = {
      decision_date: document.getElementById('dDate').value || null,
      decision,
      reason:   document.getElementById('dReason').value.trim() || null,
      approver: document.getElementById('dApprover').value.trim() || null,
    };
    try {
      if (isEdit) await Api.put(`/api/events/${eventId}/decisions/${dec.id}`, body);
      else        await Api.post(`/api/events/${eventId}/decisions`, body);
      closeModal();
      toast('Decisão salva.');
      await loadOperational();
    } catch (e) { toast(e.message); }
  });
}

async function deleteDecision(id) {
  if (!confirm('Remover esta decisão?')) return;
  await Api.del(`/api/events/${eventId}/decisions/${id}`);
  await loadOperational();
}

// ── Centro de Crises ─────────────────────────────────────────────────────────
function crisisImpactPill(i) {
  const m = { 'Alto': 'pill-no', 'Médio': 'pill-active', 'Baixo': '' };
  return `<span class="pill ${m[i] || ''}">${esc(i)}</span>`;
}
function crisisStatusPill(s) {
  const m = { 'Aberta': 'pill-no', 'Em tratamento': 'pill-active', 'Resolvida': 'pill-ok' };
  return `<span class="pill ${m[s] || ''}">${esc(s)}</span>`;
}

function renderCrises(rows) {
  crisesData = rows || [];
  const open  = crisesData.filter((c) => c.status !== 'Resolvida').length;
  const badge = document.getElementById('crisesCount');
  if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
  document.getElementById('crisesTotal').innerHTML = `${crisesData.length} ocorrência(s)${open ? ` · <span style="color:var(--danger)">${open} em aberto</span>` : ''}`;

  const el = document.getElementById('crisesList');
  if (!crisesData.length) { el.innerHTML = '<p class="muted">Nenhuma ocorrência registrada.</p>'; return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Data/Hora</th><th>Descrição</th><th>Impacto</th><th>Ação tomada</th><th>Responsável</th><th>Status</th><th></th></tr></thead>
    <tbody>${crisesData.map((c) => `<tr>
      <td class="muted" style="font-size:12px;white-space:nowrap">${c.occurred_at ? fmtDateTimeBR(c.occurred_at) : '—'}</td>
      <td><strong>${esc(c.description)}</strong></td>
      <td>${crisisImpactPill(c.impact)}</td>
      <td class="muted" style="font-size:13px;max-width:200px">${esc(c.action_taken || '—')}</td>
      <td>${esc(c.responsible || '—')}</td>
      <td>${crisisStatusPill(c.status)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEditCrisis(${c.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteCrisis(${c.id})">Remover</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function openAddCrisis() { showCrisisModal(null); }
function openEditCrisis(id) { showCrisisModal(crisesData.find((c) => c.id === id)); }

function showCrisisModal(cr) {
  const isEdit = !!cr;
  const IMPACTS  = ['Alto', 'Médio', 'Baixo'];
  const STATUSES = ['Aberta', 'Em tratamento', 'Resolvida'];
  // Datetime local for input[type=datetime-local]
  const dtVal = cr?.occurred_at ? cr.occurred_at.replace(' ', 'T').slice(0, 16) : '';
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${isEdit ? 'Editar ocorrência' : 'Nova ocorrência'}</h2>
        <div class="field"><label>Data/Hora da ocorrência</label><input type="datetime-local" id="crAt" value="${dtVal}" /></div>
        <div class="field"><label>Descrição *</label><textarea id="crDesc" rows="2">${esc(cr?.description || '')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="field"><label>Impacto</label>
            <select id="crImpact">${IMPACTS.map((i) => `<option ${(cr?.impact||'Médio')===i?'selected':''}>${i}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Status</label>
            <select id="crStatus">${STATUSES.map((s) => `<option ${(cr?.status||'Aberta')===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label>Ação tomada</label><textarea id="crAction" rows="2">${esc(cr?.action_taken || '')}</textarea></div>
        <div class="field"><label>Responsável</label><input type="text" id="crResp" value="${esc(cr?.responsible || '')}" /></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="crSaveBtn">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('crSaveBtn').addEventListener('click', async () => {
    const description = document.getElementById('crDesc').value.trim();
    if (!description) { toast('Informe a descrição.'); return; }
    const rawDt = document.getElementById('crAt').value;
    const body = {
      occurred_at:  rawDt ? rawDt.replace('T', ' ') : null,
      description,
      impact:       document.getElementById('crImpact').value,
      action_taken: document.getElementById('crAction').value.trim() || null,
      responsible:  document.getElementById('crResp').value.trim() || null,
      status:       document.getElementById('crStatus').value,
    };
    try {
      if (isEdit) await Api.put(`/api/events/${eventId}/crises/${cr.id}`, body);
      else        await Api.post(`/api/events/${eventId}/crises`, body);
      closeModal();
      toast('Ocorrência salva.');
      await loadOperational();
    } catch (e) { toast(e.message); }
  });
}

async function deleteCrisis(id) {
  if (!confirm('Remover esta ocorrência?')) return;
  await Api.del(`/api/events/${eventId}/crises/${id}`);
  await loadOperational();
}

// ── Relatório Pós-Evento ─────────────────────────────────────────────────────
let postReportData = null;

function renderPostReport(data) {
  postReportData = data?.report || null;
  const r = postReportData;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('prAudience', r?.audience_count ?? '');
  set('prRating',   r?.rating ?? '');
  set('prSummary',  r?.summary);
  set('prWorked',   r?.what_worked);
  set('prImprove',  r?.what_improve);
  set('prLessons',  r?.lessons);
  const statusEl = document.getElementById('prStatus');
  if (statusEl) statusEl.value = r?.status || 'Rascunho';
  const meta = document.getElementById('prMeta');
  if (meta && r) meta.textContent = `Atualizado por ${r.updated_by || '—'} em ${fmtDateTimeBR(r.updated_at)}`;
  else if (meta) meta.textContent = 'Nenhum dado salvo ainda.';
}

async function savePostReport() {
  const body = {
    summary:        document.getElementById('prSummary').value.trim() || null,
    audience_count: document.getElementById('prAudience').value ? Number(document.getElementById('prAudience').value) : null,
    what_worked:    document.getElementById('prWorked').value.trim() || null,
    what_improve:   document.getElementById('prImprove').value.trim() || null,
    lessons:        document.getElementById('prLessons').value.trim() || null,
    rating:         document.getElementById('prRating').value ? Number(document.getElementById('prRating').value) : null,
    status:         document.getElementById('prStatus').value,
  };
  try {
    const data = await Api.put(`/api/events/${eventId}/post-report`, body);
    renderPostReport(data);
    toast('Relatório salvo.');
  } catch (e) { toast(e.message); }
}

function exportPostReportPdf() {
  const ev = eventData?.event;
  const contracts = eventData?.contracts || [];
  const checklist = eventData?.checklist || [];
  const r = postReportData;

  const total  = contracts.reduce((s, c) => s + (c.value || 0), 0);
  const pago   = contracts.filter((c) => c.payment_status === 'Pago').reduce((s, c) => s + (c.value || 0), 0);
  const pend   = total - pago;
  const done   = checklist.filter((t) => t.status === 'Concluído').length;
  const actRisks = risksData.filter((x) => x.status === 'Ativo').length;
  const openCrises = crisesData.filter((x) => x.status !== 'Resolvida').length;

  const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
  const sectionHtml = (label, text) => text
    ? `<h2>${label}</h2><p style="white-space:pre-wrap;font-size:13px">${esc(text)}</p>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pós-Evento — ${esc(ev?.name || '')}</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1A1F2B;max-width:820px;margin:32px auto;padding:0 20px}
    .brand{font-size:24px;font-weight:800;letter-spacing:-.02em;color:#0E1B3D}.brand i{color:#00C2B8;font-style:normal}
    .tag{color:#64748B;font-size:12px;margin-bottom:18px}
    h1{font-size:22px;margin:14px 0 2px;color:#152C6B}
    h2{font-size:15px;margin:26px 0 8px;color:#152C6B;border-bottom:2px solid #00C2B8;padding-bottom:4px}
    .meta{font-size:13px;color:#64748B;margin-bottom:24px}
    .stats{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
    .stat{flex:1;min-width:110px;background:#F1F5F9;border-radius:8px;padding:10px 12px}
    .stat .n{font-size:17px;font-weight:700;color:#152C6B}.stat .l{font-size:11px;color:#64748B}
    table{width:100%;border-collapse:collapse;font-size:13px}
    td,th{padding:7px 9px;border-bottom:1px solid #E2E8F0;text-align:left}
    th{font-size:11px;text-transform:uppercase;color:#64748B}
    @media print{body{margin:12px auto}}
  </style></head><body>
  <div class="brand">moura <i>one</i></div>
  <div class="tag">Relatório Pós-Evento</div>
  <h1>${esc(ev?.name || '')}</h1>
  <div class="meta">
    ${ev?.client ? esc(ev.client) + ' · ' : ''}${ev?.event_date ? fmtDateBR(ev.event_date) : ''}
    ${ev?.location ? ' · ' + esc(ev.location) : ''}${r?.rating ? ' · ' + (STARS[r.rating] || '') : ''}
    <br>Status do relatório: <strong>${r?.status || 'Rascunho'}</strong>
    ${r?.audience_count ? ' · Público: <strong>' + r.audience_count + ' pessoas</strong>' : ''}
  </div>

  <h2>Resumo Operacional</h2>
  <div class="stats">
    <div class="stat"><div class="n">${fmtMoney(total)}</div><div class="l">Total contratado</div></div>
    <div class="stat"><div class="n">${fmtMoney(pago)}</div><div class="l">Pago</div></div>
    <div class="stat"><div class="n">${fmtMoney(pend)}</div><div class="l">Pendente</div></div>
    <div class="stat"><div class="n">${done}/${checklist.length}</div><div class="l">Tarefas concluídas</div></div>
    <div class="stat"><div class="n">${actRisks}</div><div class="l">Riscos ativos</div></div>
    <div class="stat"><div class="n">${openCrises}</div><div class="l">Crises em aberto</div></div>
    <div class="stat"><div class="n">${decisionsData.length}</div><div class="l">Decisões registradas</div></div>
  </div>

  ${sectionHtml('Resumo Geral', r?.summary)}
  ${sectionHtml('O que funcionou bem', r?.what_worked)}
  ${sectionHtml('O que melhorar', r?.what_improve)}
  ${sectionHtml('Lições aprendidas', r?.lessons)}

  ${contracts.length ? `
  <h2>Contratações</h2>
  <table><thead><tr><th>Fornecedor</th><th>Valor</th><th>Status</th><th>Pagamento</th></tr></thead><tbody>
    ${contracts.map((c) => `<tr><td>${esc(c.company)}</td><td>${fmtMoney(c.value)}</td><td>${esc(c.status)}</td><td>${esc(c.payment_status)}</td></tr>`).join('')}
  </tbody></table>` : ''}

  <p style="margin-top:36px;color:#94A3B8;font-size:11px">Gerado em ${new Date().toLocaleString('pt-BR')} · Moura One</p>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.print();
}

// Barras de formatação do pós-evento
['prSummaryFmt', 'prWorkedFmt', 'prImproveFmt', 'prLessonsFmt'].forEach((fmtId) => {
  const el = document.getElementById(fmtId);
  if (el) el.innerHTML = formatToolbar(fmtId.replace('Fmt', ''));
});

document.getElementById('savePostReportBtn')?.addEventListener('click', savePostReport);
document.getElementById('exportPostReportPdfBtn')?.addEventListener('click', exportPostReportPdf);

// ── Eventos Relacionados (Lote D) ────────────────────────────────────────────
function relStatusPill(s) {
  const map = { 'Planejamento': '', 'Contratação': 'pill-active', 'Produção': 'pill-ok', 'Evento realizado': 'pill-ok', 'Encerrado': '' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
}

function renderRelated(rows) {
  const el = document.getElementById('relatedCard');
  if (!el) return;
  const canEdit = canEditEvent();
  const list = (rows && rows.length)
    ? rows.map((e) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--gray-soft)">
        <div style="flex:1;min-width:0">
          <a href="/admin/event-detail.html?id=${e.id}" style="font-weight:600">${esc(e.name)}</a>
          <div class="muted" style="font-size:12px">${[e.client, e.event_date ? fmtDateBR(e.event_date) : null].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
        ${relStatusPill(e.status)}
        ${canEdit ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="unlinkRelated(${e.id})">Desvincular</button>` : ''}
      </div>`).join('')
    : '<p class="muted" style="font-size:13px;padding:6px 0">Nenhum evento vinculado. Útil para conectar edições anuais ou eventos da mesma série.</p>';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:15px;font-weight:600">Eventos relacionados</div>
      ${canEdit ? '<button class="btn btn-ghost btn-sm" id="linkEventBtn">+ Vincular evento</button>' : ''}
    </div>
    ${list}`;

  const btn = document.getElementById('linkEventBtn');
  if (btn) btn.addEventListener('click', openLinkEventModal);
}

async function openLinkEventModal() {
  let events = [];
  try { events = await Api.get('/api/events'); } catch { events = []; }
  const linkedIds = new Set((relatedData || []).map((r) => r.id));
  const candidates = events.filter((e) => e.id !== Number(eventId) && !linkedIds.has(e.id));

  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>Vincular evento</h2>
        <div class="field"><label>Buscar evento</label>
          <input type="text" id="linkSearch" placeholder="Filtrar pela lista…" />
        </div>
        <div class="field"><label>Selecione</label>
          <select id="linkSelect" size="8" style="width:100%">
            ${candidates.map((e) => `<option value="${e.id}">${esc(e.name)}${e.event_date ? ' — ' + fmtDateBR(e.event_date) : ''}${e.client ? ' (' + esc(e.client) + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="linkSaveBtn">Vincular</button>
        </div>
      </div>
    </div>`;

  const select = document.getElementById('linkSelect');
  document.getElementById('linkSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    Array.from(select.options).forEach((o) => { o.hidden = !o.text.toLowerCase().includes(q); });
  });
  document.getElementById('linkSaveBtn').addEventListener('click', async () => {
    const relId = Number(select.value);
    if (!relId) { toast('Selecione um evento.'); return; }
    try {
      await Api.post(`/api/events/${eventId}/relations`, { related_event_id: relId });
      closeModal();
      toast('Evento vinculado.');
      await loadOperational();
    } catch (err) { toast(err.message); }
  });
}

async function unlinkRelated(rid) {
  if (!confirm('Desvincular este evento?')) return;
  try {
    await Api.del(`/api/events/${eventId}/relations/${rid}`);
    toast('Vínculo removido.');
    await loadOperational();
  } catch (e) { toast(e.message); }
}

// Botão "Modo Dia do Evento"
const dayBtn = document.getElementById('eventDayBtn');
if (dayBtn) dayBtn.href = `/admin/event-day.html?id=${eventId}`;

// ── RSVP & Check-in (Lote Integração) ───────────────────────────────────────
function showIntegrationsTab(ev) {
  const hasRsvp    = !!ev.rsvp_event_id;
  const hasCheckin = !!ev.checkin_event_id;
  const tab = document.getElementById('integrationsTab');
  if (tab && (hasRsvp || hasCheckin)) tab.classList.remove('hidden');

  if (hasRsvp) {
    const lbl = document.getElementById('rsvpIdLabel');
    if (lbl) lbl.textContent = `ID: ${ev.rsvp_event_id}`;
    loadRsvpMetrics(ev.rsvp_event_id);
  } else {
    const card = document.getElementById('rsvpCard');
    if (card) card.innerHTML = '<p class="muted" style="font-size:13px">Evento não provisionado no RSVP. Acesse "Editar evento" para provisionar.</p>';
  }

  if (hasCheckin) {
    const lbl = document.getElementById('checkinIdLabel');
    if (lbl) lbl.textContent = `ID: ${ev.checkin_event_id}`;
    loadCheckinMetrics(ev.checkin_event_id);
  } else {
    const card = document.getElementById('checkinCard');
    if (card) card.innerHTML = '<p class="muted" style="font-size:13px">Evento não provisionado no Check-in. Acesse "Editar evento" para provisionar.</p>';
  }

  // Botão Abrir RSVP
  const rsvpBtn = document.getElementById('openRsvpBtn');
  if (rsvpBtn) {
    rsvpBtn.style.display = hasRsvp ? '' : 'none';
    rsvpBtn.addEventListener('click', async () => {
      rsvpBtn.disabled = true; rsvpBtn.textContent = 'Aguarde…';
      try {
        const { url } = await Api.post('/api/integrations/sso-token', { target: 'rsvp', event_id: Number(eventId) });
        window.open(url, '_blank');
      } catch (e) { toast(e.message); }
      finally { rsvpBtn.disabled = false; rsvpBtn.textContent = '🔗 Abrir RSVP'; }
    });
  }

  // Botão Abrir Check-in
  const ciBtn = document.getElementById('openCheckinBtn');
  if (ciBtn) {
    ciBtn.style.display = hasCheckin ? '' : 'none';
    ciBtn.addEventListener('click', async () => {
      ciBtn.disabled = true; ciBtn.textContent = 'Aguarde…';
      try {
        // Check-in usa link direto (sem SSO; autenticado pelo token de operador).
        const ev2 = eventData?.event;
        if (!ev2?.checkin_event_id) { toast('ID do Check-in não configurado.'); return; }
        const checkinBase = (await fetch('/api/integrations/checkin-metrics/' + encodeURIComponent(ev2.checkin_event_id), { headers: { Authorization: `Bearer ${Api.token()}` } })).ok
          ? null : null; // só para testar conectividade; a URL vem da config do servidor
        toast('Abra o Check-in via link de operador.');
      } catch (e) { toast(e.message); }
      finally { ciBtn.disabled = false; ciBtn.textContent = '🔗 Abrir Check-in'; }
    });
  }

  // Botão Gerar link de operador
  const opBtn = document.getElementById('genOperatorTokenBtn');
  if (opBtn) {
    opBtn.style.display = hasCheckin ? '' : 'none';
    opBtn.addEventListener('click', () => openOperatorTokenModal(eventData?.event?.checkin_event_id));
  }
}

async function loadRsvpMetrics(rsvpEventId) {
  const el = document.getElementById('rsvpMetrics');
  if (!el) return;
  el.innerHTML = '<p class="muted" style="font-size:13px">Carregando métricas…</p>';
  try {
    const m = await Api.get(`/api/integrations/rsvp-metrics/${encodeURIComponent(rsvpEventId)}`);
    const confirmed = m.confirmed ?? m.total_confirmed ?? m.confirmados ?? '—';
    const declined  = m.declined  ?? m.total_declined  ?? m.recusados  ?? '—';
    const pending   = m.pending   ?? m.total_pending   ?? m.pendentes  ?? '—';
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      <div style="background:var(--off-white);border-radius:8px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:#16a34a">${confirmed}</div>
        <div style="font-size:12px;color:var(--muted)">Confirmados</div>
      </div>
      <div style="background:var(--off-white);border-radius:8px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--danger)">${declined}</div>
        <div style="font-size:12px;color:var(--muted)">Recusados</div>
      </div>
      <div style="background:var(--off-white);border-radius:8px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--navy)">${pending}</div>
        <div style="font-size:12px;color:var(--muted)">Pendentes</div>
      </div>
    </div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted" style="font-size:13px">Não foi possível carregar métricas: ${esc(e.message)}</p>`;
  }
}

async function loadCheckinMetrics(checkinEventId) {
  const el = document.getElementById('checkinMetrics');
  if (!el) return;
  el.innerHTML = '<p class="muted" style="font-size:13px">Carregando métricas…</p>';
  try {
    const m = await Api.get(`/api/integrations/checkin-metrics/${encodeURIComponent(checkinEventId)}`);
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      <div style="background:var(--off-white);border-radius:8px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--navy)">${m.total_checkins ?? '—'}</div>
        <div style="font-size:12px;color:var(--muted)">Check-ins realizados</div>
      </div>
    </div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted" style="font-size:13px">Não foi possível carregar métricas: ${esc(e.message)}</p>`;
  }
}

function openOperatorTokenModal(checkinEventId) {
  if (!checkinEventId) { toast('ID do Check-in não configurado.'); return; }
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>Gerar link de operador</h2>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Gera um link de acesso único para o operador de check-in no local do evento.</p>
        <div class="field"><label>Identificação do operador</label><input type="text" id="opLabel" placeholder="ex: Entrada principal" /></div>
        <div class="field"><label>Validade (horas)</label><input type="number" id="opHours" value="12" min="1" max="72" /></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="opGenBtn">Gerar link</button>
        </div>
      </div>
    </div>`;
  document.getElementById('opGenBtn').addEventListener('click', async () => {
    const label = document.getElementById('opLabel').value.trim() || null;
    const hours = Number(document.getElementById('opHours').value) || 12;
    const btn = document.getElementById('opGenBtn');
    btn.disabled = true; btn.textContent = 'Gerando…';
    try {
      const { url, token, expires_at } = await Api.post('/api/integrations/operator-token', {
        checkin_event_id: checkinEventId, label, expires_hours: hours,
      });
      closeModal();
      const display = url || token;
      document.getElementById('modalSlot').innerHTML = `
        <div class="modal-bg">
          <div class="modal">
            <h2>Link gerado</h2>
            <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Válido até ${fmtDateTimeBR(expires_at)}. Compartilhe apenas com o operador responsável.</p>
            <div style="background:var(--off-white);border-radius:8px;padding:14px;word-break:break-all;font-size:13px;font-family:monospace;margin-bottom:16px">${esc(display)}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn btn-ghost" onclick="navigator.clipboard.writeText(${JSON.stringify(display)}).then(()=>toast('Copiado!'))">Copiar</button>
              <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
            </div>
          </div>
        </div>`;
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Gerar link';
      toast(e.message);
    }
  });
}

// ── Carregar dados operacionais (Lotes B, C e D) ─────────────────────────────
let relatedData = [];
async function loadOperational() {
  const [approvals, risks, decisions, crises, prData, related] = await Promise.all([
    Api.get(`/api/events/${eventId}/approvals`),
    Api.get(`/api/events/${eventId}/risks`),
    Api.get(`/api/events/${eventId}/decisions`),
    Api.get(`/api/events/${eventId}/crises`),
    Api.get(`/api/events/${eventId}/post-report`),
    Api.get(`/api/events/${eventId}/relations`),
  ]);
  renderApprovals(approvals);
  renderRisks(risks);
  renderDecisions(decisions);
  renderCrises(crises);
  renderPostReport(prData);
  relatedData = related || [];
  renderRelated(relatedData);
}

// Botões do Lote B
document.getElementById('addApprovalBtn').addEventListener('click', openAddApproval);
document.getElementById('addRiskBtn').addEventListener('click', openAddRisk);
document.getElementById('addDecisionBtn').addEventListener('click', openAddDecision);
document.getElementById('addCrisisBtn').addEventListener('click', openAddCrisis);

load().catch(console.error);
loadOperational().catch(console.error);
