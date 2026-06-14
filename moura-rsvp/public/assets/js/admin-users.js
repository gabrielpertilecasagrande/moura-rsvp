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

const ROLE_LABEL = { admin: 'Administrador', editor: 'Editor' };
const STATUS = {
  ativo: { label: 'Ativo', cls: 'pill-ok' },
  pendente: { label: 'Pendente', cls: 'pill-warn' },
  recusado: { label: 'Recusado', cls: 'pill-no' },
  inativo: { label: 'Inativo', cls: 'pill-no' },
};

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
      <td class="row-name">${esc(u.name)}${isMe ? ' <span class="muted" style="font-weight:400">(você)</span>' : ''}</td>
      <td>${esc(u.email)}</td>
      <td>${ROLE_LABEL[u.role] || u.role}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td style="text-align:right;white-space:nowrap">
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

function modal(html) { document.getElementById('modalSlot').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }

const inputRow = (id, label, value, type = 'text') =>
  `<div class="field" style="text-align:left"><label>${label}</label><input type="${type}" id="${id}" value="${esc(value) || ''}" /></div>`;
const roleSelect = (id, val) =>
  `<div class="field" style="text-align:left"><label>Permissão</label><select id="${id}">
    <option value="editor" ${val === 'editor' ? 'selected' : ''}>Editor — gerencia eventos e participantes</option>
    <option value="admin" ${val === 'admin' ? 'selected' : ''}>Administrador — acesso total + usuários</option>
  </select></div>`;

function newUser() {
  modal(`
    <h3 style="font-size:17px;margin-bottom:4px">Novo usuário</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">A conta já é criada ativa, pronta para usar.</p>
    ${inputRow('nu_name', 'Nome completo', '')}
    ${inputRow('nu_email', 'E-mail', '', 'email')}
    ${inputRow('nu_pass', 'Senha (mínimo 6 caracteres)', '', 'password')}
    ${roleSelect('nu_role', 'editor')}
    <p class="error-msg hidden" id="nu_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="createUser()">Criar usuário</button>
    </div>`);
}
async function createUser() {
  const v = (id) => document.getElementById(id).value.trim();
  const err = document.getElementById('nu_err');
  const payload = { name: v('nu_name'), email: v('nu_email'), password: document.getElementById('nu_pass').value, role: document.getElementById('nu_role').value };
  if (!payload.name || !payload.email || !payload.password) { err.textContent = 'Preencha nome, e-mail e senha.'; err.classList.remove('hidden'); return; }
  try { await Api.post('/api/users', payload); closeModal(); toast('Usuário criado.'); refresh(); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

function editUser(id) {
  const u = USERS.find((x) => x.id === id);
  if (!u) return;
  const statusSel = `<div class="field" style="text-align:left"><label>Situação</label><select id="eu_status">
    ${['ativo', 'inativo', 'pendente', 'recusado'].map((s) => `<option value="${s}" ${u.status === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}
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
    ${inputRow('rp_pass', 'Nova senha (mínimo 6 caracteres)', '', 'password')}
    <p class="error-msg hidden" id="rp_err" style="text-align:left"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="doReset(${id})">Redefinir</button>
    </div>`);
}
async function doReset(id) {
  const err = document.getElementById('rp_err');
  const password = document.getElementById('rp_pass').value;
  try { await Api.post(`/api/users/${id}/password`, { password }); closeModal(); toast('Senha redefinida.'); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
}

async function removeUser(id) {
  const u = USERS.find((x) => x.id === id);
  if (!confirm(`Excluir a conta de ${u ? u.name : 'este usuário'}? Esta ação não pode ser desfeita.`)) return;
  try { await Api.del(`/api/users/${id}`); toast('Usuário excluído.'); refresh(); }
  catch (e) { toast(e.message); }
}

document.getElementById('newUserBtn').addEventListener('click', newUser);
(async () => { await refresh(); })().catch((e) => toast(e.message));
