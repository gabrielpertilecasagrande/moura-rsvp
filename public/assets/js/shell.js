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
  const nav = [
    item('/admin/dashboard.html', 'dashboard', 'Dashboard'),
    item('/admin/event-form.html', 'new', 'Novo evento'),
    isAdmin ? item('/admin/users.html', 'users', 'Usuários') : '',
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
}
