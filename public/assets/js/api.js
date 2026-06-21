// Helpers de chamada à API + sessão do admin (frontend).
const Api = {
  token: () => localStorage.getItem('moura_token'),
  refreshToken: () => localStorage.getItem('moura_refresh'),
  setToken: (t) => localStorage.setItem('moura_token', t),
  // Guarda a sessão completa (JWT de acesso + refresh token de login persistente).
  setSession: (s) => {
    if (!s) return;
    if (s.token) localStorage.setItem('moura_token', s.token);
    if (s.refresh_token) localStorage.setItem('moura_refresh', s.refresh_token);
  },
  clear: () => { localStorage.removeItem('moura_token'); localStorage.removeItem('moura_refresh'); },

  // Renovação silenciosa: troca o refresh token por um novo JWT de acesso sem
  // pedir senha. "Single-flight": chamadas concorrentes reaproveitam a mesma
  // promessa, evitando várias renovações em paralelo (abas/requisições simultâneas).
  _refreshing: null,
  tryRefresh() {
    const rt = Api.refreshToken();
    if (!rt) return Promise.resolve(false);
    if (Api._refreshing) return Api._refreshing;
    Api._refreshing = fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { Api.setSession(d); return true; })
      .catch(() => { Api.clear(); return false; })
      .finally(() => { Api._refreshing = null; });
    return Api._refreshing;
  },

  // Logout consciente: revoga a sessão persistente no servidor e limpa o local.
  async logout() {
    const rt = Api.refreshToken();
    if (rt) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
      } catch { /* mesmo offline, o logout local abaixo basta */ }
    }
    Api.clear();
  },

  _toLogin() { Api.clear(); location.href = '/admin/login.html'; },

  async req(method, url, body, isForm, _retried) {
    const headers = {};
    const t = Api.token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    let payload = body;
    if (body && !isForm) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(url, { method, headers, body: payload });
    if (res.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
      // JWT expirado: tenta renovar silenciosamente UMA vez e refaz a chamada.
      // Só desloga se não houver refresh token ou se a renovação falhar.
      if (!_retried && Api.refreshToken()) {
        const ok = await Api.tryRefresh();
        if (ok) return Api.req(method, url, body, isForm, true);
      }
      Api._toLogin();
      return;
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : res;
    if (!res.ok) throw new Error((data && data.error) || 'Erro na requisição.');
    return data;
  },
  get: (u) => Api.req('GET', u),
  post: (u, b) => Api.req('POST', u, b),
  put: (u, b) => Api.req('PUT', u, b),
  del: (u) => Api.req('DELETE', u),
  postForm: (u, fd) => Api.req('POST', u, fd, true),
  putForm: (u, fd) => Api.req('PUT', u, fd, true),
};

function requireSession() {
  if (!Api.token()) { location.href = '/admin/login.html'; }
}

// ── Sessão persistente: renovação automática via refresh token ────────────────
// Mantém o usuário "sempre logado" como um app nativo. O JWT de acesso é curto
// (12h); o refresh token (em localStorage) é trocado por um novo JWT em silêncio,
// ~5 min antes de expirar — e também sob demanda quando uma chamada volta 401
// (ver Api.req). Sem refresh token (sessão antiga), o próximo 401 leva ao login.
Api.tokenExpMs = function () {
  const t = Api.token();
  if (!t) return null;
  try {
    const seg = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(seg));
    return payload && payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
};

// Login persistente: com refresh token, a sessão se renova sozinha ~5 min antes
// do JWT expirar — o usuário NUNCA vê a tela de login só porque o app ficou
// fechado. Se a renovação falhar (refresh expirado/revogado), para de reagendar;
// a próxima chamada à API cai no fluxo de 401 → login.
function scheduleAutoRefresh() {
  const exp = Api.tokenExpMs();
  if (!exp) { Api.tryRefresh(); return; } // sem JWT legível: tenta renovar já
  const LEAD = 5 * 60 * 1000;
  const wait = Math.max(0, exp - LEAD - Date.now());
  setTimeout(async () => {
    const ok = await Api.tryRefresh();
    if (ok) scheduleAutoRefresh(); // reagenda com a nova expiração
  }, Math.min(wait, 11.5 * 60 * 60 * 1000));
}

document.addEventListener('DOMContentLoaded', () => {
  if (location.pathname.endsWith('/login.html') || !Api.token()) return;
  if (Api.refreshToken()) scheduleAutoRefresh();
});

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function fmtDateBR(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
function fmtDateTimeBR(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- ENTER confirma/prossegue na janela modal aberta ----
// Vale para qualquer popup (.modal dentro de .modal-bg). Em textareas, o Enter
// continua quebrando linha normalmente. Aciona o botão de ação principal do modal
// (btn-primary; senão, a ação destrutiva habilitada, como "Excluir definitivamente").
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
  const modal = document.querySelector('.modal-bg .modal');
  if (!modal) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'button' || tag === 'select') return;
  const btn = modal.querySelector('[data-enter]:not([disabled])')
    || modal.querySelector('.btn-primary:not([disabled])')
    || modal.querySelector('.btn-danger:not([disabled])');
  if (btn) { e.preventDefault(); btn.click(); }
});

// ---- ESC fecha qualquer janela modal aberta ----
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const slot = document.getElementById('modalSlot');
  let closed = false;
  if (slot && slot.innerHTML.trim()) { slot.innerHTML = ''; closed = true; }
  document.querySelectorAll('.modal-bg').forEach((m) => { m.remove(); closed = true; });
  // Fecha também a gaveta lateral (mobile), se aberta.
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open')) {
    sb.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
  }
});

// ---- Visualizador de senha (ícone de olho) em todos os campos de senha ----
const EYE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
function enhancePasswords(root) {
  (root || document).querySelectorAll('input[type=password]:not([data-eye])').forEach((inp) => {
    inp.setAttribute('data-eye', '1');
    const wrap = document.createElement('div');
    wrap.className = 'pwd-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'pwd-eye'; btn.setAttribute('aria-label', 'Mostrar senha');
    btn.innerHTML = EYE_SVG;
    wrap.appendChild(btn);
    btn.addEventListener('click', () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
    });
  });
}
const _pwObserver = new MutationObserver(() => enhancePasswords());
document.addEventListener('DOMContentLoaded', () => {
  enhancePasswords();
  if (document.body) _pwObserver.observe(document.body, { childList: true, subtree: true });
});

// ---- Botão de atualizar (flecha girando) reutilizável ----
const REFRESH_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
// Cria um botão de refresh + texto "Atualizado às HH:MM" que gira o ícone ao recarregar.
// Auto-expand para textareas (fallback para navegadores sem field-sizing:content)
document.addEventListener('input', function(e) {
  if (e.target.tagName !== 'TEXTAREA') return;
  if (CSS.supports('field-sizing', 'content')) return;
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 300) + 'px';
});

function refreshButton(fn, title) {
  const wrap = document.createElement('span');
  wrap.className = 'refresh-wrap';
  const stamp = document.createElement('span');
  stamp.className = 'refresh-stamp';
  const setStamp = () => {
    const now = new Date();
    stamp.textContent = 'Atualizado às ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm btn-refresh';
  btn.title = title || 'Atualizar';
  btn.setAttribute('aria-label', title || 'Atualizar');
  btn.innerHTML = REFRESH_SVG;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('spinning')) return;
    btn.classList.add('spinning');
    try { await fn(); setStamp(); } catch (e) { if (typeof toast === 'function') toast(e.message); }
    finally { setTimeout(() => btn.classList.remove('spinning'), 400); }
  });
  setStamp(); // hora do carregamento inicial
  wrap.appendChild(stamp);
  wrap.appendChild(btn);
  return wrap;
}
