requireSession();
if (!isPlatformAdmin()) location.href = '/admin/dashboard.html';
mountShell('platform');

let ORGS = [];

async function load() {
  const rows = document.getElementById('rows');
  try {
    ORGS = await Api.get('/api/platform/tenants');
    render(ORGS);
  } catch (e) {
    rows.innerHTML = `<tr><td colspan="4" class="muted" style="padding:16px">${esc(e.message)}</td></tr>`;
  }
}

function render(orgs) {
  const rows = document.getElementById('rows');
  if (!orgs.length) {
    rows.innerHTML = '<tr><td colspan="4" class="muted" style="padding:16px">Nenhum organizador cadastrado.</td></tr>';
    return;
  }
  rows.innerHTML = orgs.map((o) => `
    <tr>
      <td><strong>${esc(o.slug)}</strong></td>
      <td>${esc(o.name)}</td>
      <td class="muted">${esc((o.created_at || '').slice(0, 10))}</td>
      <td style="text-align:right">
        <button class="btn btn-sm" onclick="downloadBackup('${esc(o.slug)}', this)">Backup</button>
      </td>
    </tr>`).join('');
}

function newOrg() {
  modal(`
    <h3 style="margin:0 0 4px">Novo organizador</h3>
    <p class="muted" style="margin:0 0 16px;font-size:13px">Cria a organização e o primeiro administrador.</p>
    <p class="error-msg hidden" id="mErr"></p>
    <div class="field"><label>Nome da organização</label><input id="mName" placeholder="ACME Eventos" /></div>
    <div class="field"><label>Slug (opcional)</label><input id="mSlug" placeholder="derivado do nome se vazio" /></div>
    <div class="field"><label>Nome do admin (opcional)</label><input id="mAdminName" placeholder="Maria Silva" /></div>
    <div class="field"><label>E-mail do admin</label><input id="mAdminEmail" type="email" /></div>
    <div class="field"><label>Senha do admin</label><input id="mAdminPass" type="password" placeholder="mín. 8 caracteres" /></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="mSave" data-enter onclick="saveOrg()">Criar organizador</button>
    </div>
  `);
  document.getElementById('mName').focus();
}

async function saveOrg() {
  const err = document.getElementById('mErr');
  err.classList.add('hidden');
  const btn = document.getElementById('mSave');
  btn.disabled = true; btn.textContent = 'Criando…';
  try {
    const result = await Api.post('/api/platform/tenants', {
      orgName:       document.getElementById('mName').value.trim(),
      orgSlug:       document.getElementById('mSlug').value.trim() || undefined,
      adminName:     document.getElementById('mAdminName').value.trim() || undefined,
      adminEmail:    document.getElementById('mAdminEmail').value.trim(),
      adminPassword: document.getElementById('mAdminPass').value,
    });
    closeModal();
    toast(`Organizador "${result.name}" criado. Admin: ${result.admin.email}`);
    await load();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Criar organizador';
  }
}

async function downloadBackup(slug, btn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando…';
  try {
    const res = await fetch(`/api/platform/tenants/${encodeURIComponent(slug)}/backup`, {
      headers: { Authorization: 'Bearer ' + Api.token() },
    });
    if (!res.ok) throw new Error('Falha ao gerar backup.');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rsvp-${slug}-${new Date().toISOString().slice(0, 10)}.db`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

function modal(html) {
  document.getElementById('modalSlot').innerHTML =
    `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { document.getElementById('modalSlot').innerHTML = ''; }

document.getElementById('newOrgBtn').addEventListener('click', newOrg);
(async () => { await load(); })().catch((e) => toast(e.message));
