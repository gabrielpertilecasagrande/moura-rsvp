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
  const map = { 'Em negociação': '', 'Aprovado': 'pill-ok', 'Recusado': 'pill-no', 'Cancelado': '' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
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
    body.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Nenhuma contratação ainda.</td></tr>';
    return;
  }
  body.innerHTML = contracts.map((c) => `<tr class="contract-row">
    <td><strong>${esc(c.company)}</strong></td>
    <td>${c.category ? `<span class="pill">${esc(c.category)}</span>` : '—'}</td>
    <td style="white-space:nowrap">${fmtMoney(c.value)}</td>
    <td>${contractStatusPill(c.status)}</td>
    <td>${paymentPill(c.payment_status)}</td>
    <td class="muted" style="font-size:13px">${esc(c.notes || '—')}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-ghost btn-sm" onclick="openEditContract(${c.id})">Editar</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteContract(${c.id})">Remover</button>
    </td>
  </tr>`).join('');
}

// ── Checklist ─────────────────────────────────────────────────────────────────
function renderChecklist(tasks, filter) {
  const open = tasks?.filter((t) => t.status !== 'Concluído').length || 0;
  const badge = document.getElementById('checklistCount');
  if (open > 0) { badge.textContent = open; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  const filtered = filter ? tasks?.filter((t) => t.status === filter) : tasks;
  const el = document.getElementById('checklistList');
  if (!filtered?.length) {
    el.innerHTML = '<p class="muted">Nenhuma tarefa encontrada.</p>';
    return;
  }
  el.innerHTML = filtered.map((t) => `
    <div class="checklist-item ${t.status === 'Concluído' ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" class="checklist-check" ${t.status === 'Concluído' ? 'checked' : ''} onchange="toggleTask(${t.id}, this.checked)" />
      <div class="checklist-info">
        <div class="checklist-title">${esc(t.title)}</div>
        <div class="checklist-meta">
          ${t.responsible ? `<span>👤 ${esc(t.responsible)}</span>` : ''}
          ${t.due_date ? `<span style="margin-left:8px">📅 ${fmtDateBR(t.due_date)}</span>` : ''}
          <span style="margin-left:8px">${taskStatusPill(t.status)}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="openEditTask(${t.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteTask(${t.id})">✕</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('checklistFilter').addEventListener('change', (e) => {
  renderChecklist(eventData?.checklist, e.target.value);
});

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
  if (!entries?.length) { el.innerHTML = '<p class="muted">Nenhuma entrada no diário.</p>'; return; }
  el.innerHTML = entries.map((en) => `
    <div class="diary-entry">
      <div class="diary-header">
        <strong>${esc(en.author || '?')}</strong>
        <span class="muted" style="font-size:12px">${fmtDateTimeBR(en.created_at)}</span>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);margin-left:auto" onclick="deleteDiaryEntry(${en.id})">✕</button>
      </div>
      <div class="diary-text">${esc(en.entry)}</div>
    </div>
  `).join('');
}

document.getElementById('saveDiaryBtn').addEventListener('click', async () => {
  const txt = document.getElementById('diaryEntry').value.trim();
  if (!txt) { toast('Escreva algo no diário.'); return; }
  const btn = document.getElementById('saveDiaryBtn');
  btn.disabled = true;
  try {
    await Api.post(`/api/events/${eventId}/diary`, { entry: txt });
    document.getElementById('diaryEntry').value = '';
    await load();
    toast('Entrada registrada.');
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
});

async function deleteDiaryEntry(did) {
  if (!confirm('Remover entrada?')) return;
  await Api.del(`/api/events/${eventId}/diary/${did}`);
  await load();
}

// ── Contratação ───────────────────────────────────────────────────────────────
async function loadSuppliers() {
  if (suppliersCache.length > 0) return;
  suppliersCache = await Api.get('/api/suppliers?limit=999');
}

function openAddContract() {
  loadSuppliers();
  const opt = suppliersCache.map((s) => `<option value="${s.id}">${esc(s.company)}</option>`).join('');
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:500px">
        <h3 style="margin-bottom:20px">Adicionar Contratação</h3>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Fornecedor</label>
          <select id="contractSupplier" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="">Selecione...</option>${opt}</select>
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Valor</label>
          <input type="number" id="contractValue" placeholder="0,00" step="0.01" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Status</label>
          <select id="contractStatus" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="Em negociação">Em negociação</option><option value="Aprovado">Aprovado</option><option value="Recusado">Recusado</option><option value="Cancelado">Cancelado</option></select>
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Pagamento</label>
          <select id="contractPayment" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="Pendente">Pendente</option><option value="Parcial">Parcial</option><option value="Pago">Pago</option></select>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Notas</label>
          <textarea id="contractNotes" placeholder="Anotações..." style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit;min-height:60px"></textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary btn-sm" onclick="saveContract()">Adicionar</button>
        </div>
      </div>
    </div>
  `;
}

function openEditContract(cid) {
  loadSuppliers();
  const c = eventData.contracts.find((x) => x.id === cid);
  if (!c) return;
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:500px">
        <h3 style="margin-bottom:20px">Editar Contratação</h3>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Fornecedor</label>
          <div style="padding:8px;background:var(--off-white);border-radius:6px">${esc(c.company)}</div>
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Valor</label>
          <input type="number" id="contractValue" step="0.01" value="${c.value || ''}" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Status</label>
          <select id="contractStatus" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="Em negociação" ${c.status==='Em negociação'?'selected':''}>Em negociação</option><option value="Aprovado" ${c.status==='Aprovado'?'selected':''}>Aprovado</option><option value="Recusado" ${c.status==='Recusado'?'selected':''}>Recusado</option><option value="Cancelado" ${c.status==='Cancelado'?'selected':''}>Cancelado</option></select>
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Pagamento</label>
          <select id="contractPayment" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="Pendente" ${c.payment_status==='Pendente'?'selected':''}>Pendente</option><option value="Parcial" ${c.payment_status==='Parcial'?'selected':''}>Parcial</option><option value="Pago" ${c.payment_status==='Pago'?'selected':''}>Pago</option></select>
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Notas</label>
          <textarea id="contractNotes" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px;font-family:inherit;min-height:60px">${esc(c.notes || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary btn-sm" onclick="saveContract(${cid})">Salvar</button>
        </div>
      </div>
    </div>
  `;
}

async function saveContract(cid) {
  const supplierId = document.getElementById('contractSupplier')?.value;
  const value = parseFloat(document.getElementById('contractValue').value) || 0;
  const status = document.getElementById('contractStatus').value;
  const payment_status = document.getElementById('contractPayment').value;
  const notes = document.getElementById('contractNotes').value.trim();
  if (cid) {
    await Api.put(`/api/events/${eventId}/contracts/${cid}`, { value, status, payment_status, notes });
  } else {
    if (!supplierId) { toast('Selecione um fornecedor.'); return; }
    await Api.post(`/api/events/${eventId}/contracts`, { supplier_id: parseInt(supplierId), value, status, payment_status, notes });
  }
  closeModal();
  await load();
}

async function deleteContract(cid) {
  if (!confirm('Remover contratação?')) return;
  await Api.del(`/api/events/${eventId}/contracts/${cid}`);
  await load();
}

// ── Checklist ─────────────────────────────────────────────────────────────────
function openAddTask() {
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:500px">
        <h3 style="margin-bottom:20px">Adicionar Tarefa</h3>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Título *</label>
          <input type="text" id="taskTitle" placeholder="Ex: Contratar fotógrafo" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Responsável</label>
          <input type="text" id="taskResponsible" placeholder="Nome" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Data de Vencimento</label>
          <input type="date" id="taskDueDate" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Status</label>
          <select id="taskStatus" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="Pendente">Pendente</option><option value="Em andamento">Em andamento</option><option value="Concluído">Concluído</option></select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary btn-sm" onclick="saveTask()">Criar</button>
        </div>
      </div>
    </div>
  `;
}

function openEditTask(tid) {
  const t = eventData.checklist.find((x) => x.id === tid);
  if (!t) return;
  document.getElementById('modalSlot').innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:500px">
        <h3 style="margin-bottom:20px">Editar Tarefa</h3>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Título *</label>
          <input type="text" id="taskTitle" value="${esc(t.title)}" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Responsável</label>
          <input type="text" id="taskResponsible" value="${esc(t.responsible || '')}" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Data de Vencimento</label>
          <input type="date" id="taskDueDate" value="${t.due_date || ''}" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px" />
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Status</label>
          <select id="taskStatus" style="width:100%;padding:8px;border:1px solid var(--gray-soft);border-radius:6px"><option value="Pendente" ${t.status==='Pendente'?'selected':''}>Pendente</option><option value="Em andamento" ${t.status==='Em andamento'?'selected':''}>Em andamento</option><option value="Concluído" ${t.status==='Concluído'?'selected':''}>Concluído</option></select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary btn-sm" onclick="saveTask(${tid})">Salvar</button>
        </div>
      </div>
    </div>
  `;
}

async function saveTask(tid) {
  const title = document.getElementById('taskTitle').value.trim();
  const responsible = document.getElementById('taskResponsible').value.trim();
  const due_date = document.getElementById('taskDueDate').value;
  const status = document.getElementById('taskStatus').value;
  if (!title) { toast('Informe o título da tarefa.'); return; }
  if (tid) {
    await Api.put(`/api/events/${eventId}/checklist/${tid}`, { title, responsible, due_date, status });
  } else {
    await Api.post(`/api/events/${eventId}/checklist`, { title, responsible, due_date, status });
  }
  closeModal();
  await load();
}

async function deleteTask(tid) {
  if (!confirm('Remover tarefa?')) return;
  await Api.del(`/api/events/${eventId}/checklist/${tid}`);
  await load();
}

function closeModal() {
  document.getElementById('modalSlot').innerHTML = '';
}

load().catch(console.error);
