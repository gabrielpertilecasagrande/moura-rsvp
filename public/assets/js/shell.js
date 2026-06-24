// Converte papéis antigos para o novo modelo de perfis.
function normRole(role) {
  if (role === 'editor') return 'gestor';
  return ['admin', 'gestor', 'operador', 'cliente'].includes(role) ? role : 'operador';
}
const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador', cliente: 'Cliente' };

// Lê dados do usuário a partir do token JWT, sem chamada extra.
function currentUser() {
  try {
    const t = Api.token();
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { id: p.id, name: p.name || '', email: p.email || '', role: normRole(p.role) };
  } catch { return { role: 'operador' }; }
}
function currentRole() { return currentUser().role; }
// Perfis que podem criar eventos.
function canCreateEvents() { return ['admin', 'gestor'].includes(currentRole()); }

function renderShell(active) {
  const u = currentUser();
  const isAdmin = u.role === 'admin';
  const item = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  const usersItem = isAdmin
    ? `<a href="/admin/users.html" class="${active === 'users' ? 'active' : ''}" id="navUsers">Usuários<span class="nav-badge hidden" id="pendingBadge">0</span></a>`
    : '';
  const nav = [
    item('/admin/dashboard.html', 'dashboard', 'Dashboard'),
    canCreateEvents() ? item('/admin/event-form.html', 'new', 'Novo evento') : '',
    usersItem,
    isAdmin ? item('/admin/activity.html', 'activity', 'Atividades') : '',
    isAdmin ? item('/admin/lgpd.html', 'lgpd', 'LGPD') : '',
    isAdmin ? item('/admin/push-history.html', 'push', 'Notificações Push') : '',
    isAdmin ? item('/admin/trash.html', 'trash', 'Lixeira') : '',
  ].join('');
  const initials = (u.name || u.email || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `
  <header class="topbar">
    <button class="hamburger" id="hamburgerBtn" aria-label="Abrir menu"><span></span></button>
    <a href="/admin/dashboard.html" style="display:flex;align-items:center;text-decoration:none" title="Moura RSVP"><img src="/assets/img/logo-moura.png" alt="Moura RSVP" style="height:46px;width:auto;display:block"></a>
  </header>
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <a href="/admin/dashboard.html" style="display:block;text-decoration:none" title="Moura RSVP"><img src="/assets/img/logo-moura.png" alt="Moura RSVP" style="width:100%;height:auto;display:block"></a>
      <div class="logo-tag">Confirmação de Presença</div>
    </div>
    <nav>${nav}<div id="navQuickLinks"></div></nav>
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
      <div class="side-version">Moura RSVP · Confirmação de presença</div>
    </div>
  </aside>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
}

function mountShell(active) {
  document.getElementById('shell').innerHTML = renderShell(active);
  document.getElementById('logoutBtn').addEventListener('click', async () => { await Api.logout(); location.href = '/admin/login.html'; });

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const ham = document.getElementById('hamburgerBtn');
  const open = () => { sidebar.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
  if (ham) ham.addEventListener('click', open);
  if (overlay) overlay.addEventListener('click', close);
  sidebar.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', close));

  // Notificação: solicitações de acesso pendentes (apenas administradores).
  if (currentRole() === 'admin') refreshPendingBadge();

  // Links de acesso rápido a outras plataformas (Moura One e Check-in).
  loadSideQuickLinks();

  checkMaintenance();
  setInterval(checkMaintenance, 5 * 60 * 1000);
}

async function loadSideQuickLinks() {
  const slot = document.getElementById('navQuickLinks');
  if (!slot) return;
  let cfg = {};
  try { cfg = await Api.get('/api/public/app-config'); } catch { /* sem config → links ocultos */ }
  const isPwa = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
  const extAttrs = isPwa ? '' : 'target="_blank" rel="noopener"';
  const links = [
    cfg.moura_one_url ? `<a href="${cfg.moura_one_url}/admin/dashboard.html" ${extAttrs}>Moura One</a>` : '',
    cfg.checkin_url   ? `<a href="${cfg.checkin_url}" ${extAttrs}>Check-in</a>` : '',
  ].filter(Boolean);
  if (!links.length) return;
  slot.innerHTML = `<div class="nav-sep"></div>${links.join('')}`;
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

// ---- Aviso de manutenção programada ----
let _maintState = null;

function showMaintenanceBanner(notice) {
  const main = document.querySelector('.main');
  if (!main) return;
  let el = document.getElementById('maintenanceBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'maintenanceBanner';
    main.insertBefore(el, main.firstChild);
  }
  const fmtDt = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };
  const defaultMsg = `Manutenção programada de <strong>${fmtDt(notice.start_at)}</strong> a <strong>${fmtDt(notice.end_at)}</strong>. Durante este período pode haver instabilidades.`;
  const bodyHtml = notice.message
    ? `<strong>${notice.active ? 'Manutenção em andamento' : 'Manutenção programada'}</strong> — ${notice.message}`
    : (notice.active ? `<strong>Manutenção em andamento</strong> até <strong>${fmtDt(notice.end_at)}</strong>. Pode haver instabilidades.` : defaultMsg);
  el.style.cssText = 'background:' + (notice.active ? '#fff1f2;color:#9b1c1c;border:1px solid #fca5a5' : '#fffbeb;color:#78350f;border:1px solid #fcd34d') + ';border-radius:10px;padding:12px 16px;font-size:13.5px;line-height:1.5;margin-bottom:18px;display:flex;align-items:flex-start;gap:10px';
  el.innerHTML = `<span style="font-size:18px">${notice.active ? '⚠️' : '🔔'}</span><span style="flex:1">${bodyHtml}</span><button style="flex:none;background:transparent;border:none;cursor:pointer;font-size:15px;opacity:.6;margin-left:auto;padding:0 2px" onclick="document.getElementById('maintenanceBanner').remove()">✕</button>`;
}

async function checkMaintenance() {
  try {
    const r = await Api.get('/api/maintenance');
    const newState = r.active ? 'active' : (r.upcoming ? 'upcoming' : null);
    if (newState) {
      if (newState !== _maintState) showMaintenanceBanner(r);
    } else {
      const el = document.getElementById('maintenanceBanner');
      if (el) el.remove();
    }
    _maintState = newState;
  } catch { /* silencioso */ }
}
