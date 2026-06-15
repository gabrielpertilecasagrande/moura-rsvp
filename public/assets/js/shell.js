// Lê dados do usuário a partir do token JWT, sem chamada extra.
function currentUser() {
  try {
    const t = Api.token();
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { id: p.id, name: p.name || '', email: p.email || '', role: p.role || 'editor' };
  } catch { return { role: 'editor' }; }
}
function currentRole() { return currentUser().role; }

function renderShell(active) {
  const u = currentUser();
  const isAdmin = u.role === 'admin';
  const item = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  const usersItem = isAdmin
    ? `<a href="/admin/users.html" class="${active === 'users' ? 'active' : ''}" id="navUsers">Usuários<span class="nav-badge hidden" id="pendingBadge">0</span></a>`
    : '';
  const nav = [
    item('/admin/dashboard.html', 'dashboard', 'Dashboard'),
    item('/admin/event-form.html', 'new', 'Novo evento'),
    usersItem,
    isAdmin ? item('/admin/activity.html', 'activity', 'Atividades') : '',
  ].join('');
  const initials = (u.name || u.email || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `
  <header class="topbar">
    <button class="hamburger" id="hamburgerBtn" aria-label="Abrir menu"><span></span></button>
    <img class="topbar-logo" src="/assets/img/logo-moura.png" alt="Moura" style="filter:brightness(0) invert(1)" />
  </header>
  <aside class="sidebar" id="sidebar">
    <div class="brand"><img src="/assets/img/logo-moura.png" alt="Moura" /></div>
    <nav>${nav}</nav>
    <div class="spacer"></div>
    <div class="side-foot">
      <div class="side-user">
        <span class="side-avatar">${esc(initials || '?')}</span>
        <span class="side-user-info">
          <span class="side-user-name">${esc(u.name || 'Usuário')}</span>
          <span class="side-user-role">${u.role === 'admin' ? 'Administrador' : 'Editor'}</span>
        </span>
      </div>
      <button class="side-account" id="accountBtn">Minha conta</button>
      <button class="logout" id="logoutBtn">Sair</button>
      <div class="side-version">Moura RSVP · Confirmação de presença</div>
    </div>
  </aside>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
}

function mountShell(active) {
  document.getElementById('shell').innerHTML = renderShell(active);
  document.getElementById('logoutBtn').addEventListener('click', () => { Api.clear(); location.href = '/admin/login.html'; });

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const ham = document.getElementById('hamburgerBtn');
  const open = () => { sidebar.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
  if (ham) ham.addEventListener('click', open);
  if (overlay) overlay.addEventListener('click', close);
  sidebar.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', close));

  const accBtn = document.getElementById('accountBtn');
  if (accBtn) accBtn.addEventListener('click', () => { close(); openAccountModal(); });

  // Notificação: solicitações de acesso pendentes (apenas administradores).
  if (currentRole() === 'admin') refreshPendingBadge();
}

// ---- Selo de notificação de solicitações de acesso pendentes ----
async function refreshPendingBadge() {
  const badge = document.getElementById('pendingBadge');
  if (!badge) return;
  try {
    const { count } = await Api.get('/api/users/pending-count');
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
      badge.title = `${count} solicitação(ões) de acesso aguardando aprovação`;
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* silencioso */ }
}

// ---- Modal "Minha conta": troca da própria senha ----
function shellModal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" style="max-width:420px;text-align:left">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  if (typeof enhancePasswords === 'function') enhancePasswords(bg);
  return bg;
}

function openAccountModal() {
  const u = currentUser();
  const bg = shellModal(`
    <h3 style="font-size:17px;margin-bottom:4px">Minha conta</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">${esc(u.name || '')} · ${esc(u.email || '')}</p>
    <div class="field"><label>Senha atual</label><input type="password" id="ac_cur" autocomplete="current-password" /></div>
    <div class="field"><label>Nova senha</label><input type="password" id="ac_new" autocomplete="new-password" placeholder="Mínimo 8 caracteres" /></div>
    <div class="field"><label>Confirmar nova senha</label><input type="password" id="ac_new2" autocomplete="new-password" /></div>
    <p class="error-msg hidden" id="ac_err"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-ghost btn-sm" id="ac_cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="ac_save">Alterar senha</button>
    </div>`);
  const err = bg.querySelector('#ac_err');
  bg.querySelector('#ac_cancel').addEventListener('click', () => bg.remove());
  bg.querySelector('#ac_save').addEventListener('click', async () => {
    const cur = bg.querySelector('#ac_cur').value;
    const nw = bg.querySelector('#ac_new').value;
    const nw2 = bg.querySelector('#ac_new2').value;
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (!cur || !nw) return fail('Preencha a senha atual e a nova senha.');
    if (nw.length < 8) return fail('A nova senha deve ter ao menos 8 caracteres.');
    if (nw !== nw2) return fail('A confirmação não corresponde à nova senha.');
    try {
      await Api.post('/api/auth/password', { current_password: cur, new_password: nw });
      bg.remove();
      toast('Senha alterada com sucesso.');
    } catch (e) { fail(e.message); }
  });
  setTimeout(() => bg.querySelector('#ac_cur')?.focus(), 30);
}
