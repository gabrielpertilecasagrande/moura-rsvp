function renderShell(active) {
  return `
  <aside class="sidebar">
    <div class="brand"><img src="/assets/img/logo-moura.png" alt="Moura" /></div>
    <nav>
      <a href="/admin/dashboard.html" class="${active === 'dashboard' ? 'active' : ''}">Painel</a>
      <a href="/admin/event-form.html" class="${active === 'new' ? 'active' : ''}">Novo evento</a>
    </nav>
    <div class="spacer"></div>
    <button class="logout" id="logoutBtn">Sair</button>
  </aside>`;
}
function mountShell(active) {
  document.getElementById('shell').innerHTML = renderShell(active);
  document.getElementById('logoutBtn').addEventListener('click', () => { Api.clear(); location.href = '/admin/login.html'; });
}
