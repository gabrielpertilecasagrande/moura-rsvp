requireSession();
// Apenas administradores acessam esta página.
if (currentRole() !== 'admin') location.href = '/admin/dashboard.html';
mountShell('users');

function myId() {
  try {
    const p = JSON.parse(atob(Api.token().split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.id;
  } catch { return null; }
}
const ME = myId();

const ROLE_LABEL = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador', cliente: 'Cliente', editor: 'Gestor de Eventos' };
const ROLE_DESC = {
  admin: 'Acesso total ao sistema.',
  gestor: 'Cria e gerencia os eventos autorizados. Não gerencia usuários.',
  operador: 'Consulta eventos autorizados e gerencia convidados. Não cria eventos.',
  cliente: 'Visualiza apenas os eventos liberados para ele. Acesso somente-leitura.',
};
const STATUS = {
  ativo: { label: 'Ativo', cls: 'pill-ok' },
  pendente: { label: 'Convite pendente', cls: 'pill-warn' },
  recusado: { label: 'Recusado', cls: 'pill-no' },
  inativo: { label: 'Inativo', cls: 'pill-no' },
  bloqueado: { label: 'Bloqueado', cls: 'pill-no' },
};
// Rótulos curtos das 8 permissões por evento (cabeçalho da matriz).
const PERM_COLS = [
  { key: 'can_view', short: 'Ver', label: 'Visualizar evento' },
  { key: 'can_edit', short: 'Editar', label: 'Editar evento' },
  { key: 'can_participants', short: 'Particip.', label: 'Gerenciar participantes' },
  { key: 'can_export', short: 'Exportar', label: 'Exportar relatórios' },
  { key: 'can_history', short: 'Histórico', label: 'Visualizar histórico' },
  { key: 'can_messages', short: 'Mensagens', label: 'Enviar mensagens' },
  { key: 'can_duplicate', short: 'Duplicar', label: 'Duplicar evento' },
  { key: 'can_delete', short: 'Excluir', label: 'Excluir evento' },
];

async function load() {
  const users = await Api.get('/api/users');
  renderPending(users.filter((u) => u.status === 'pendente'));
  renderRows(users);
}

function renderPending(list) {
  const wrap = document.getElementById('pendingWrap');
  if (!list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:18px;border-left:4px solid var(--cyan)">
      <h2 style="font-size:16px;margin-bottom:4px">Solicitações de acesso (${list.length})</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">Contas aguardando aprovação. Aprove para liberar o login.</p>
      ${list.map((u) => `
        <div class="pending-row">
          <div>
            <div style="font-weight:600">${esc(u.name)}</div>
            <div class="muted" style="font-size:13px">${esc(u.email)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="approve(${u.id})">Aprovar</button>
            <button class="btn btn-ghost btn-sm" onclick="reject(${u.id})">Recusar</button>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderRows(list) {
  const tb = document.getElementById('rows');
  tb.innerHTML = list.map((u) => {
    const st = STATUS[u.status] || { label: u.status, cls: '' };
    const isMe = u.id === ME;
    return `
    <tr>
      <td class="row-name">${esc(u.name)}${isMe ? ' <span class="muted" style="font-weight:400">(você)</span>' : ''}${u.source === 'moura_one' ? ' <span class="origin-selo">◆ Moura One</span>' : ''}</td>
      <td data-label="E-mail" class="break-anywhere">${esc(u.email)}</td>
      <td data-label="Permissão">${ROLE_LABEL[u.role] || u.role}</td>
      <td data-label="Situação"><span class="pill ${st.cls}">${st.label}</span></td>
      <td data-label="Último acesso" style="white-space:nowrap;font-size:13px">${u.last_login ? fmtDateTimeBR(u.last_login) : '<span class="muted">nunca</span>'}</td>
      <td data-label="Criado em" style="white-space:nowrap;font-size:13px">${u.created_at ? fmtDateBR(u.created_at.slice(0, 10)) : '—'}</td>
      <td class="cell-actions" style="text-align:right;white-space:nowrap">
        ${u.role === 'admin' ? '' : `<button class="btn btn-ghost btn-sm" onclick="manageAccess(${u.id})">Acessos</button>`}
        <button class="btn btn-ghost btn-sm" onclick="editUser(${u.id})">Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="resetPass(${u.id})">Senha</button>
        ${isMe ? '' : `<button class="btn btn-danger btn-sm" onclick="removeUser(${u.id})">Excluir</button>`}
      </td>
    </tr>`;
  }).join('');
}

let USERS = [];
async function refresh() { USERS = await Api.get('/api/users'); renderPending(USERS.filter((u) => u.status === 'pendente')); renderRows(USERS); }

async function approve(id) { try { await Api.post(`/api/users/${id}/approve`); toast('Acesso aprovado.'); refresh(); } catch (e) { toast(e.message); } }
async function reject(id) { if (!confirm('Recusar esta solicitação de acesso?')) return; try { await Api.post(`/api/users/${id}/reject`); toast('Solicitação recusada.'); refresh(); } catch (e) { toast(e.message); } }

function modal(html) { document.getElementById('modalSlot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this&&document._mdTarget===this)closeModal()"><div class="modal">${html}</div></div>`; }
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }

const inputRow = (id, label, value, type = 'text') =>
  `<div class="field" style="text-align:left"><label>${label}</label><input type="${type}" id="${id}" value="${esc(value) || ''}" /></div>`;
const roleSelect = (id, val) => {
  const v = val === 'editor' ? 'gestor' : (val || 'operador');
  return `<div class="field" style="text-align:left"><label>Perfil de acesso</label><select id="${id}">
    <option value="cliente" ${v === 'cliente' ? 'selected' : ''}>Cliente — visualiza apenas os eventos dele (somente-leitura)</option>
    <option value="operador" ${v === 'operador' ? 'selected' : ''}>Operador — consulta eventos e gerencia convidados</option>
    <option value="gestor" ${v === 'gestor' ? 'selected' : ''}>Gestor de Eventos — cria e gerencia eventos autorizados</option>
    <option value="admin" ${v === 'admin' ? 'selected' : ''}>Administrador — acesso total ao sistema</option>
  </select></div>`;
};

function newUser() {
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Novo usuário</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">A conta já é criada ativa, pronta para usar.</p>
    ${inputRow('nu_name', 'Nome completo', '')}
    ${inputRow('nu_email', 'E-mail', '', 'email')}
    ${inputRow('nu_pass', 'Senha (mínimo 8 caracteres)', '', 'password')}
    ${inputRow('nu_pass2', 'Repita a senha', '', 'password')}
    ${roleSelect('nu_role', 'cliente')}
    <p class="muted" style="font-size:12.5px;margin:-6px 0 14px;text-align:left">Use "Acessos" depois de criar para liberar eventos específicos a Gestores e Operadores.</p>
    <p class="error-msg hidden" id="nu_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="createUser()">Criar usuário</button>
    </div>`);
}
async function createUser() {
  const v = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('nu_err');
  const pass = document.getElementById('nu_pass').value;
  const pass2 = document.getElementById('nu_pass2').value;
  const payload = { name: v('nu_name'), email: v('nu_email'), password: pass, role: document.getElementById('nu_role').value };
  if (!payload.name || !payload.email || !payload.password) { err.textContent = 'Preencha nome, e-mail e senha.'; err.classList.remove('hidden'); return; }
  if (pass !== pass2) { err.textContent = 'As senhas não conferem.'; err.classList.remove('hidden'); return; }
  try { await Api.post('/api/users', payload); closeModal(); toast('Usuário criado.'); refresh(); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

function editUser(id) {
  const u = USERS.find((x) => x.id === id);
  if (!u) return;
  const statusSel = `<div class="field" style="text-align:left"><label>Situação</label><select id="eu_status">
    ${['ativo', 'inativo', 'bloqueado', 'pendente', 'recusado'].map((s) => `<option value="${s}" ${u.status === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}
  </select></div>`;
  modal(`
    <h3 style="font-size:17px;margin-bottom:16px">Editar usuário</h3>
    ${inputRow('eu_name', 'Nome completo', u.name)}
    ${inputRow('eu_email', 'E-mail', u.email, 'email')}
    ${roleSelect('eu_role', u.role)}
    ${statusSel}
    <p class="error-msg hidden" id="eu_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveUser(${id})">Salvar</button>
    </div>`);
}
async function saveUser(id) {
  const v = (x) => document.getElementById(x).value.trim();
  const err = document.getElementById('eu_err');
  const payload = { name: v('eu_name'), email: v('eu_email'), role: document.getElementById('eu_role').value, status: document.getElementById('eu_status').value };
  try { await Api.put(`/api/users/${id}`, payload); closeModal(); toast('Usuário atualizado.'); refresh(); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

function resetPass(id) {
  const u = USERS.find((x) => x.id === id);
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Redefinir senha</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">${esc(u ? u.name : '')}</p>
    ${inputRow('rp_pass', 'Nova senha (mínimo 8 caracteres)', '', 'password')}
    ${inputRow('rp_pass2', 'Repita a nova senha', '', 'password')}
    <p class="error-msg hidden" id="rp_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="doReset(${id})">Redefinir</button>
    </div>`);
}
async function doReset(id) {
  const err = document.getElementById('rp_err');
  const password = document.getElementById('rp_pass').value;
  const password2 = document.getElementById('rp_pass2').value;
  if (!password) { err.textContent = 'Informe a nova senha.'; err.classList.remove('hidden'); return; }
  if (password !== password2) { err.textContent = 'As senhas não conferem.'; err.classList.remove('hidden'); return; }
  try { await Api.post(`/api/users/${id}/password`, { password }); closeModal(); toast('Senha redefinida.'); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

function removeUser(id) {
  const u = USERS.find((x) => x.id === id);
  const nome = u ? u.name : 'este usuário';
  // Dupla verificação: exige digitar EXCLUIR antes de habilitar o botão.
  modal(`
    <h3 style="font-size:17px;margin-bottom:6px;color:var(--danger)">Excluir usuário</h3>
    <p style="font-size:14px;margin:0 0 12px;text-align:left">Você vai excluir a conta de <strong>${esc(nome)}</strong>${u ? ` (${esc(u.email)})` : ''} e todos os seus acessos. Esta ação é permanente e não pode ser desfeita.</p>
    <p class="muted" style="font-size:13px;margin:0 0 8px;text-align:left">Para confirmar, digite <strong>EXCLUIR</strong>:</p>
    <input type="text" id="du_confirm" placeholder="EXCLUIR" autocomplete="off" />
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger btn-sm" id="du_go" disabled>Excluir definitivamente</button>
    </div>`);
  const input = document.getElementById('du_confirm');
  const go = document.getElementById('du_go');
  input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'EXCLUIR'; });
  setTimeout(() => input.focus(), 30);
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Excluindo…';
    try { await Api.del(`/api/users/${id}`); closeModal(); toast('Usuário excluído.'); refresh(); }
    catch (e) { toast(e.message); go.disabled = false; go.textContent = 'Excluir definitivamente'; }
  });
}

// ---- Controle de acesso por evento (matriz de permissões) ----
function wideModal(html) {
  document.getElementById('modalSlot').innerHTML =
    `<div class="modal-bg" onclick="if(event.target===this&&document._mdTarget===this)closeModal()"><div class="modal access-modal">${html}</div></div>`;
}

let ACCESS = null; // { userId, defaults, events: [...] }

async function manageAccess(id) {
  const u = USERS.find((x) => x.id === id);
  try {
    const data = await Api.get(`/api/users/${id}/access`);
    ACCESS = { userId: id, defaults: data.defaults, events: data.events };
    renderAccessModal(u, data);
  } catch (e) { toast(e.message); }
}

function accessRow(ev) {
  const checks = PERM_COLS.map((c) =>
    `<td class="ac-cell"><input type="checkbox" data-event="${ev.id}" data-perm="${c.key}" ${ev.perms[c.key] ? 'checked' : ''} ${c.key === 'can_view' ? 'class="ac-view"' : ''} aria-label="${c.label}" /></td>`
  ).join('');
  const date = ev.event_date ? fmtDateBR(ev.event_date) : 'Data a definir';
  return `<tr data-event-row="${ev.id}" class="access-row ${ev.perms.can_view ? '' : 'ac-off'}">
    <td class="ac-name event-name-cell"><div style="font-weight:600">${esc(ev.name)}</div><div class="muted" style="font-size:12px">${date}</div></td>
    ${checks}</tr>`;
}

function renderAccessModal(u, data) {
  const head = PERM_COLS.map((c) => `<th title="${c.label}">${c.short}</th>`).join('');
  const rows = data.events.length
    ? data.events.map(accessRow).join('')
    : '<tr><td colspan="9" class="muted center" style="padding:24px">Nenhum evento cadastrado ainda.</td></tr>';
  wideModal(`
    <h3 style="font-size:17px;margin-bottom:2px">Acessos de ${esc(u ? u.name : '')}</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px;text-align:left">
      Perfil <strong>${ROLE_LABEL[data.role] || data.role}</strong>. Marque os eventos liberados e ajuste as permissões.
      Sem "Ver", o evento não fica visível para o usuário.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-ghost btn-sm" type="button" onclick="accessSelectAllView(true)">Liberar todos</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="accessSelectAllView(false)">Remover todos</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="accessApplyDefaults()">Aplicar permissões padrão do perfil</button>
    </div>
    <input type="text" placeholder="Buscar evento…" id="accessSearch" style="width:100%;margin-bottom:12px;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:13px;box-sizing:border-box" />
    <div class="access-table-wrap">
      <table class="access-table">
        <thead><tr><th class="ac-name">Evento</th>${head}</tr></thead>
        <tbody id="accessBody">${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="saveAccess(${u.id})">Salvar acessos</button>
    </div>`);

  // Ao desmarcar "Ver", limpa e desabilita as demais permissões da linha.
  document.getElementById('accessBody').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    if (cb.dataset.perm === 'can_view') syncAccessRow(cb.dataset.event);
  });
  data.events.forEach((ev) => syncAccessRow(ev.id));

  document.getElementById('accessSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#accessBody .access-row').forEach((row) => {
      const name = row.querySelector('.event-name-cell')?.textContent.toLowerCase() || '';
      row.style.display = q && !name.includes(q) ? 'none' : '';
    });
  });
}

function syncAccessRow(eventId) {
  const tr = document.querySelector(`tr[data-event-row="${eventId}"]`);
  if (!tr) return;
  const view = tr.querySelector('input[data-perm="can_view"]');
  const on = view && view.checked;
  tr.classList.toggle('ac-off', !on);
  tr.querySelectorAll('input[data-perm]').forEach((inp) => {
    if (inp.dataset.perm === 'can_view') return;
    inp.disabled = !on;
    if (!on) inp.checked = false;
  });
}

function accessSelectAllView(on) {
  document.querySelectorAll('#accessBody input[data-perm="can_view"]').forEach((cb) => {
    cb.checked = on; syncAccessRow(cb.dataset.event);
  });
}

// Aplica as permissões padrão do perfil aos eventos atualmente liberados (com "Ver").
function accessApplyDefaults() {
  const d = (ACCESS && ACCESS.defaults) || {};
  document.querySelectorAll('#accessBody tr[data-event-row]').forEach((tr) => {
    const view = tr.querySelector('input[data-perm="can_view"]');
    if (!view || !view.checked) return;
    tr.querySelectorAll('input[data-perm]').forEach((inp) => {
      if (inp.dataset.perm === 'can_view') return;
      inp.checked = !!d[inp.dataset.perm];
    });
  });
}

async function saveAccess(id) {
  const map = {};
  document.querySelectorAll('#accessBody input[data-perm]').forEach((cb) => {
    const eid = cb.dataset.event;
    if (!map[eid]) map[eid] = { event_id: Number(eid) };
    map[eid][cb.dataset.perm] = cb.checked ? 1 : 0;
  });
  const items = Object.values(map).filter((it) => it.can_view);
  try {
    const r = await Api.put(`/api/users/${id}/access`, { items });
    closeModal();
    toast(`Acessos salvos: ${r.count} evento(s) liberado(s).`);
  } catch (e) { toast(e.message); }
}

document.getElementById('newUserBtn').addEventListener('click', newUser);
document.getElementById('refreshSlot').appendChild(refreshButton(refresh, 'Atualizar usuários'));
(async () => { await refresh(); })().catch((e) => toast(e.message));
