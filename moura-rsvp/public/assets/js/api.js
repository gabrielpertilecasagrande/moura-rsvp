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
