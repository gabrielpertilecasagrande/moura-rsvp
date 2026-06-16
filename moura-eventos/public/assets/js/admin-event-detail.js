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
  document.title = `${ev.name} — Moura Eventos`;
  document.getElementById('eventName').textContent    = ev.name;
  document.getElementById('eventClient').textContent  = ev.client || 'Evento';
  document.getElementById('eventStatusPill').innerHTML = statusPill(ev.status);
  document.getElementById('editEventBtn').href = `/admin/event-form.html?id=${eventId}`;

  renderOverview(ev, d.totalValue);
  renderContracts(d.contracts, d.totalValue);
  renderChecklist(d.checklist);
  renderFiles(d.files);
  renderDiary(d.diary);
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
let checklistFilters = { status: '', priority: '', responsible: '' };

function renderChecklist(tasks) {
  const open = tasks?.filter((t) => t.status !== 'Concluído').length || 0;
  const badge = document.getElementById('checklistCount');
  if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  let filtered = tasks || [];
  if (checklistFilters.status)      filtered = filtered.filter((t) => t.status === checklistFilters.status);
  if (checklistFilters.priority)    filtered = filtered.filter((t) => (t.priority || 'Média') === checklistFilters.priority);
  if (checklistFilters.responsible) filtered = filtered.filter((t) => (t.responsible || '').toLowerCase().includes(checklistFilters.responsible.toLowerCase()));

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

async function openTaskComments(tid) {
  const task = eventData.checklist.find((t) => t.id === tid);
  if (!task) return;
  const comments = await Api.get(`/api/events/${eventId}/checklist/${tid}/comments`);
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:520px">
        <h3 style="margin-bottom:4px;font-size:16px">${esc(task.title)}</h3>
        <div style="color:var(--muted);font-size:13px;margin-bottom:16px">Comentários da tarefa</div>
        <div id="commentsList" style="max-height:260px;overflow-y:auto;margin-bottom:16px">
          ${comments.length ? comments.map((c) => `
            <div style="padding:10px;background:var(--off-white);border-radius:6px;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <strong style="font-size:13px">${esc(c.author || '?')}</strong>
                <span style="font-size:12px;color:var(--muted)">${fmtDateTimeBR(c.created_at)}</span>
              </div>
              <div style="font-size:14px">${esc(c.comment)}</div>
            </div>`).join('') : '<p class="muted">Nenhum comentário ainda.</p>'}
        </div>
        <textarea id="newComment" placeholder="Escreva um comentário..." style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit;min-height:70px;margin-bottom:12px"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button>
          <button class="btn btn-primary btn-sm" onclick="saveComment(${tid})">Comentar</button>
        </div>
      </div>
    </div>`;
}

async function saveComment(tid) {
  const comment = document.getElementById('newComment').value.trim();
  if (!comment) { toast('Escreva um comentário.'); return; }
  await Api.post(`/api/events/${eventId}/checklist/${tid}/comments`, { comment });
  closeModal();
  await load();
  toast('Comentário adicionado.');
}

async function toggleTask(tid, checked) {
  const status = checked ? 'Concluído' : 'Pendente';
  await Api.put(`/api/events/${eventId}/checklist/${tid}`, { status });
  await load();
}

// ── Arquivos ──────────────────────────────────────────────────────────────────
function renderFiles(files) {
  const el = document.getElementById('fileList');
  if (!files?.length) { el.innerHTML = '<p class="muted">Nenhum arquivo enviado.</p>'; return; }
  el.innerHTML = files.map((f) => `
    <div class="file-row">
      <div class="file-icon">${fileIcon(f.mime_type)}</div>
      <div class="file-info">
        <div class="file-name">${esc(f.filename)}</div>
        <div class="file-meta">${fmtSize(f.size)} · por ${esc(f.uploaded_by || '?')} · ${fmtDateTimeBR(f.created_at)}</div>
      </div>
      <a href="/api/events/${eventId}/files/${f.id}/download" class="btn btn-ghost btn-sm">Baixar</a>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteFile(${f.id})">✕</button>
    </div>
  `).join('');
}

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
  for (const file of Array.from(files)) {
    const fd = new FormData();
    fd.append('file', file);
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

async function deleteFile(fid) {
  if (!confirm('Remover este arquivo?')) return;
  await Api.del(`/api/events/${eventId}/files/${fid}`);
  await load();
}

// ── Diário ────────────────────────────────────────────────────────────────────
function renderDiary(entries) {
  const el = document.getElementById('diaryList');
  if (!entries?.length) { el.innerHTML = '<p class="muted">Nenhum registro ainda.</p>'; return; }
  el.innerHTML = entries.map((e) => `
    <div class="diary-entry">
      <div class="diary-meta">${fmtDateTimeBR(e.created_at)} · ${esc(e.author || '?')}</div>
      <div class="diary-text">${esc(e.entry)}</div>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger);margin-top:6px" onclick="deleteDiary(${e.id})">Remover</button>
    </div>
  `).join('');
}

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
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
          <div class="field"><label>Data da contratação</label><input type="date" id="mContractDate" value="${contract?.contract_date || ''}" /></div>
          <div class="field"><label>Previsão de pagamento</label><input type="date" id="mPaymentDue" value="${contract?.payment_due_date || ''}" /></div>
          <div class="field"><label>Data de pagamento</label><input type="date" id="mPaymentDate" value="${contract?.payment_date || ''}" /></div>
        </div>
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
      contract_date:    document.getElementById('mContractDate').value || null,
      payment_due_date: document.getElementById('mPaymentDue').value || null,
      payment_date:     document.getElementById('mPaymentDate').value || null,
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

load().catch(console.error);
