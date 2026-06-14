// Helpers de chamada à API + sessão do admin (frontend).
const Api = {
  token: () => localStorage.getItem('moura_token'),
  setToken: (t) => localStorage.setItem('moura_token', t),
  clear: () => localStorage.removeItem('moura_token'),

  async req(method, url, body, isForm) {
    const headers = {};
    const t = Api.token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    let payload = body;
    if (body && !isForm) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(url, { method, headers, body: payload });
    if (res.status === 401 && !url.includes('/auth/login')) {
      Api.clear(); location.href = '/admin/login.html'; return;
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
// Cria um botão de refresh que chama `fn` e gira o ícone enquanto carrega.
function refreshButton(fn, title) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm btn-refresh';
  btn.title = title || 'Atualizar';
  btn.setAttribute('aria-label', title || 'Atualizar');
  btn.innerHTML = REFRESH_SVG;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('spinning')) return;
    btn.classList.add('spinning');
    try { await fn(); } catch (e) { if (typeof toast === 'function') toast(e.message); }
    finally { setTimeout(() => btn.classList.remove('spinning'), 400); }
  });
  return btn;
}
