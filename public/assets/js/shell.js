// Lê o papel (role) do usuário a partir do token JWT, sem chamada extra.
function currentRole() {
  try {
    const t = Api.token();
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role || 'editor';
  } catch { return 'editor'; }
}

function renderShell(active) {
  const isAdmin = currentRole() === 'admin';
  const usersLink = isAdmin
    ? `<a href="/admin/users.html" class="${active === 'users' ? 'active' : ''}">Usuários</a>`
    : '';
  const nav = `
      <a href="/admin/dashboard.html" class="${active === 'dashboard' ? 'active' : ''}">Painel</a>
      <a href="/admin/event-form.html" class="${active === 'new' ? 'active' : ''}">Novo evento</a>
      ${usersLink}`;
  return `
  <header class="topbar">
    <button class="hamburger" id="hamburgerBtn" aria-label="Abrir menu"><span></span></button>
    <img class="topbar-logo" src="/assets/img/logo-moura.png" alt="Moura" style="filter:brightness(0) invert(1)" />
  </header>
  <aside class="sidebar" id="sidebar">
    <div class="brand"><img src="/assets/img/logo-moura.png" alt="Moura" /></div>
    <nav>${nav}</nav>
    <div class="spacer"></div>
    <button class="logout" id="logoutBtn">Sair</button>
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
  // Fecha a gaveta ao tocar num link de navegação.
  sidebar.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', close));
}
