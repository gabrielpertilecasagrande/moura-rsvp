function normRole(role) {
  if (role === 'editor') return 'gestor';
  return ['admin', 'gestor', 'operador'].includes(role) ? role : 'operador';
}
const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador' };

function currentUser() {
  try {
    const t = Api.token();
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { id: p.id, name: p.name || '', email: p.email || '', role: normRole(p.role) };
  } catch { return { role: 'operador' }; }
}
function currentRole() { return currentUser().role; }
function canCreateEvents() { return ['admin', 'gestor'].includes(currentRole()); }

function renderShell(active) {
  const u = currentUser();
  const isAdmin = u.role === 'admin';
  const item = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  const usersItem = isAdmin
    ? `<a href="/admin/users.html" class="${active === 'users' ? 'active' : ''}" id="navUsers">Usuários<span class="nav-badge hidden" id="pendingBadge">0</span></a>`
    : '';
  const nav = [
    item('/admin/command.html', 'command', 'Central de Comando'),
    item('/admin/dashboard.html', 'dashboard', 'Dashboard'),
    item('/admin/events.html', 'events', 'Eventos'),
    item('/admin/calendar.html', 'calendar', 'Calendário'),
    item('/admin/team.html', 'team', 'Equipe'),
    item('/admin/clients.html', 'clients', 'Clientes'),
    item('/admin/suppliers.html', 'suppliers', 'Fornecedores'),
    usersItem,
    isAdmin ? item('/admin/activity.html', 'activity', 'Atividades') : '',
  ].join('');
  const initials = (u.name || u.email || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `
  <header class="topbar">
    <button class="hamburger" id="hamburgerBtn" aria-label="Abrir menu"><span></span></button>
    <span class="logo-mo" style="font-size:20px"><span class="lm">moura</span><span class="lo">one</span></span>
  </header>
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <span class="logo-mo"><span class="lm">moura</span><span class="lo">one</span></span>
      <div class="logo-tag">Plataforma de Operações e Eventos</div>
    </div>
    <nav>${nav}</nav>
    <div class="spacer"></div>
    <div class="side-foot">
      <div class="side-user">
        <span class="side-avatar">${esc(initials || '?')}</span>
        <span class="side-user-info">
          <span class="side-user-name">${esc(u.name || 'Usuário')}</span>
          <span class="side-user-role">${ROLE_LABELS[u.role] || 'Operador'}</span>
        </span>
      </div>
      <a class="side-account" href="/admin/account.html" id="accountBtn">Minha conta</a>
      <button class="logout" id="logoutBtn">Sair</button>
      <div class="side-version">Moura One · Plataforma de Operações e Eventos</div>
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

  if (currentRole() === 'admin') refreshPendingBadge();
}

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
