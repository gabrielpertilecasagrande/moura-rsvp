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
  return `
  <aside class="sidebar">
    <div class="brand"><img src="/assets/img/logo-moura.png" alt="Moura" /></div>
    <nav>
      <a href="/admin/dashboard.html" class="${active === 'dashboard' ? 'active' : ''}">Painel</a>
      <a href="/admin/event-form.html" class="${active === 'new' ? 'active' : ''}">Novo evento</a>
      ${usersLink}
    </nav>
    <div class="spacer"></div>
    <button class="logout" id="logoutBtn">Sair</button>
  </aside>`;
}
function mountShell(active) {
  document.getElementById('shell').innerHTML = renderShell(active);
  document.getElementById('logoutBtn').addEventListener('click', () => { Api.clear(); location.href = '/admin/login.html'; });
}
