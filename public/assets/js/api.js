// Rastreia onde o mousedown começou — impede que soltar seleção de texto
// fora do popup feche o modal involuntariamente.
document.addEventListener('mousedown', e => { document._mdTarget = e.target; }, true);

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
    // Sempre envia o refresh token (quando houver). O backend o usa para marcar
    // "este aparelho" na lista de sessões; nas demais rotas é simplesmente ignorado.
    const rt = Api.refreshToken();
    if (rt) headers['X-Refresh-Token'] = rt;
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
    if (!res.ok) {
      const e = new Error((data && data.error) || 'Erro na requisição.');
      // Anexa o corpo completo da resposta de erro (ex.: 409 traz matched_name,
      // participant_id) para que o chamador possa exibir detalhes ao usuário.
      e.data = data;
      throw e;
    }
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

// ── Modal de confirmação reutilizável ─────────────────────────────────────────
// Substitui window.confirm() (que pode ser bloqueado em alguns navegadores quando
// "impedir que esta página crie diálogos" está ativo).
function uiConfirm({ title = 'Confirmar', message = '', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal" style="max-width:440px">
        <h2 style="margin-bottom:10px">${esc(title)}</h2>
        <div style="font-size:14px;color:var(--muted);line-height:1.55;margin-bottom:20px">${esc(message)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" data-act="cancel">${esc(cancelText)}</button>
          <button class="btn btn-primary" data-act="ok" data-enter ${danger ? 'style="background:var(--danger);border-color:var(--danger)"' : ''}>${esc(confirmText)}</button>
        </div>
      </div>`;
    const done = (val) => { bg.remove(); document.removeEventListener('keydown', onKey, true); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    bg.addEventListener('click', (e) => {
      if (e.target === bg && document._mdTarget === bg) return done(false);
      const act = e.target.closest('[data-act]')?.getAttribute('data-act');
      if (act === 'ok') done(true);
      else if (act === 'cancel') done(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bg);
    bg.querySelector('[data-act="ok"]').focus();
  });
}

// ── Notificações push (Web Push) ──────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const Push = {
  supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },
  isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  },
  isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  },
  iosNeedsInstall() {
    return Push.isIOS() && !Push.isStandalone();
  },
  async status() {
    if (Push.iosNeedsInstall()) return 'ios-install';
    if (!Push.supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      return sub ? 'on' : 'off';
    } catch { return 'off'; }
  },
  async enable() {
    if (!Push.supported()) throw new Error('Este aparelho ou navegador não suporta notificações.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Permissão de notificações não concedida.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await Api.get('/api/push/vapid-public-key');
    if (!publicKey) throw new Error('Servidor sem notificações push disponíveis.');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await Api.post('/api/push/subscribe', { subscription: sub });
    return true;
  },
  async disable() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        try { await Api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* segue */ }
        await sub.unsubscribe();
      }
    } catch { /* nada a fazer */ }
    return true;
  },
  test() { return Api.post('/api/push/test'); },
  async localTest() {
    if (!Push.supported()) throw new Error('Este navegador não suporta notificações.');
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Permissão de notificações não concedida.');
    }
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('🔔 Moura RSVP — teste local', {
      body: 'Se você está vendo isto, as notificações funcionam neste aparelho!',
      icon: '/assets/img/icon-192.png',
      badge: '/assets/img/icon-96.png',
      tag: 'moura-local-test',
    });
    return true;
  },
};

// Registra o service worker e exibe banner quando há nova versão disponível.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
    catch (_) { return; }

    let updateClicked = false, reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateClicked || reloading) return;
      reloading = true;
      window.location.reload();
    });

    function showUpdateBanner(worker) {
      if (!worker || document.getElementById('pwaUpdateBanner') || !document.body) return;
      const bar = document.createElement('div');
      bar.id = 'pwaUpdateBanner';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);background:#152C6B;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px -8px rgba(14,27,61,.6);font-size:14px';
      const txt = document.createElement('span');
      txt.textContent = '✨ Nova versão disponível';
      txt.style.fontWeight = '600';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = 'Atualizar';
      btn.style.cssText = 'flex:none;background:#00C2B8;color:#04201E;border:none;border-radius:999px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer';
      btn.addEventListener('click', () => {
        updateClicked = true; btn.disabled = true; btn.textContent = 'Atualizando…';
        try { worker.postMessage({ type: 'skip-waiting' }); } catch (_) {}
        // Rede de segurança: se o navegador não trocar de controlador por
        // qualquer motivo (já aconteceu — o botão ficava travado em
        // "Atualizando…" para sempre), força o reload mesmo assim.
        setTimeout(() => { if (!reloading) { reloading = true; window.location.reload(); } }, 3000);
      });
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '✕';
      close.style.cssText = 'flex:none;background:transparent;color:#cdd6ee;border:none;font-size:16px;cursor:pointer;padding:4px';
      close.addEventListener('click', () => bar.remove());
      bar.append(txt, btn, close);
      document.body.appendChild(bar);
    }

    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(sw);
      });
    });

    const checkUpdate = () => { reg.update().catch(() => {}); };
    checkUpdate();
    setInterval(checkUpdate, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
    window.addEventListener('focus', checkUpdate);
  });
}
