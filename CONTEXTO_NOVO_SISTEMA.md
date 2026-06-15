# Contexto Técnico — Sistemas Moura

> Envie este arquivo ao início de qualquer nova sessão do Claude Code para criar
> um sistema Moura que siga o mesmo padrão visual, arquitetura e correções já aplicadas.

---

## 1. Visão geral da stack

| Camada | Tecnologia |
|--------|------------|
| Backend | Node.js + Express |
| Banco de dados | SQLite via `better-sqlite3` (fallback: `node:sqlite` nativo do Node ≥ 22.5) |
| Auth | JWT (12 h de validade), bcrypt para senhas |
| Frontend | HTML + CSS + JavaScript puro (sem framework) |
| Exportações | ExcelJS (XLSX), pdfkit (PDF), CSV nativo |

---

## 2. Design System

### Fontes (Google Fonts)
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" />
```

- **Space Grotesk** — títulos (`h1–h4`, `.eyebrow`, números de estatística)
- **Plus Jakarta Sans** — subtítulos e destaques suaves
- **Inter** — corpo de texto, botões, formulários

### Paleta de cores (variáveis CSS)
```css
:root {
  --navy:       #2C427E;   /* primária — sidebar, botões principais */
  --navy-deep:  #21345f;   /* hover de navy */
  --cyan:       #2BC2CE;   /* destaque — active nav, badge, accent */
  --cyan-soft:  #e6f8fa;   /* fundo suave de pills "ok" */
  --off-white:  #F2F3F3;   /* fundo geral da página */
  --gray:       #D9D9D9;   /* bordas de inputs e tabelas */
  --gray-soft:  #eceded;   /* fundo de linhas pares, bordas leves */
  --charcoal:   #28282A;   /* texto principal */
  --muted:      #6b6f78;   /* texto secundário */
  --danger:     #c2553e;   /* vermelho — erros, exclusão, bloqueio */
  --white:      #fff;
  --radius:     14px;
  --radius-sm:  9px;
  --shadow:     0 1px 2px rgba(40,40,42,.06), 0 8px 24px rgba(40,40,42,.06);
  --shadow-lg:  0 12px 40px rgba(33,52,95,.16);
  --display:      'Space Grotesk', system-ui, sans-serif;
  --display-soft: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --body:         'Inter', system-ui, -apple-system, sans-serif;
}
```

### Componentes CSS principais
- `.btn`, `.btn-primary`, `.btn-accent`, `.btn-ghost`, `.btn-danger`, `.btn-sm`
- `.card` — card branco com sombra e border-radius
- `.pill`, `.pill-ok`, `.pill-no`, `.pill-active`, `.pill-inactive`
- `.stat` — card de estatística com barra colorida na esquerda (`.tone-navy`, `.tone-cyan`, `.tone-red`, `.tone-gray`)
- `.table-wrap` — wrapper de tabela com scroll horizontal
- `.field` — grupo label + input/select/textarea
- `.modal-bg` + `.modal` — janela modal (ESC fecha, ENTER aciona botão primário)
- `.toast` — notificação temporária (2,6 s)
- `.eyebrow` — label uppercase pequeno em cyan (acima de títulos)
- `.muted` — texto secundário
- `.hidden` — `display: none !important`

---

## 3. Estrutura do shell administrativo

### HTML base de uma página admin
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Título — Moura SISTEMA</title>
  <link rel="stylesheet" href="/assets/css/styles.css" />
</head>
<body>
  <div class="admin-shell">
    <div id="shell"></div>
    <main class="main">
      <div class="page-head">
        <div>
          <div class="eyebrow">Subtítulo</div>
          <h1>Título da Página</h1>
        </div>
        <!-- botões de ação aqui -->
      </div>
      <!-- conteúdo da página -->
    </main>
  </div>
  <div id="modalSlot"></div>
  <script src="/assets/js/api.js"></script>
  <script src="/assets/js/shell.js"></script>
  <script src="/assets/js/minha-pagina.js"></script>
</body>
</html>
```

O `shell.js` renderiza sidebar + topbar dentro de `<div id="shell">`.  
A chamada obrigatória no JS da página é:
```js
requireSession(); // redireciona para /admin/login.html se não há token
mountShell('chave-da-pagina'); // 'dashboard' | 'users' | 'activity' | qualquer outra chave
```

---

## 4. Utilitário de API (api.js)

```js
// Token JWT armazenado em localStorage.
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
  get:      (u)    => Api.req('GET',    u),
  post:     (u, b) => Api.req('POST',   u, b),
  put:      (u, b) => Api.req('PUT',    u, b),
  del:      (u)    => Api.req('DELETE', u),
  postForm: (u, fd) => Api.req('POST',  u, fd, true),
  putForm:  (u, fd) => Api.req('PUT',   u, fd, true),
};

// Utilitários globais
function requireSession() { if (!Api.token()) location.href = '/admin/login.html'; }
function toast(msg) { /* notificação temporária — implementado em api.js */ }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtDateBR(dateStr) { /* AAAA-MM-DD → DD/MM/AAAA */ }
function fmtDateTimeBR(s)   { /* datetime SQLite → localização pt-BR */ }
function refreshButton(fn, title) { /* botão de refresh com ícone girando */ }
```

Comportamentos automáticos embutidos em `api.js`:
- **ENTER** em modais aciona o botão `.btn-primary` (ou `.btn-danger` habilitado)
- **ESC** fecha qualquer modal aberto (`#modalSlot` ou `.modal-bg`)
- Ícone de olho em todos os `input[type=password]`

---

## 5. Shell (shell.js)

```js
// Perfis disponíveis
// admin    — acesso total, gerencia usuários, vê todos os eventos
// gestor   — cria eventos, gerencia os eventos autorizados
// operador — consulta eventos autorizados, gerencia participantes

function normRole(role) {
  if (role === 'editor') return 'gestor'; // compatibilidade legada
  return ['admin', 'gestor', 'operador'].includes(role) ? role : 'operador';
}
const ROLE_LABELS = { admin: 'Administrador', gestor: 'Gestor de Eventos', operador: 'Operador' };

function currentUser()   { /* lê payload do JWT */ }
function currentRole()   { return currentUser().role; }
function canCreateEvents() { return ['admin', 'gestor'].includes(currentRole()); }

// mountShell(active) — renderiza sidebar + topbar
// Itens da nav: Dashboard, Novo evento (admin/gestor), Usuários (admin), Atividades (admin)
// Rodapé: avatar com iniciais, nome, papel, "Minha conta", "Sair"
// Badge vermelho em "Usuários" mostrando solicitações de acesso pendentes
```

---

## 6. RBAC — Controle de acesso

### Perfis
| Role | Cria eventos | Gerencia usuários | Vê todos os eventos |
|------|:---:|:---:|:---:|
| `admin` | ✅ | ✅ | ✅ |
| `gestor` | ✅ | ❌ | ❌ (apenas autorizados) |
| `operador` | ❌ | ❌ | ❌ (apenas autorizados) |

### Status de usuário
`pendente` → `ativo` → `inativo` / `recusado` / `bloqueado`

### Permissões granulares por evento (tabela `event_access`)
```
can_view        — Visualizar evento
can_edit        — Editar evento
can_participants — Gerenciar participantes
can_export      — Exportar relatórios
can_history     — Visualizar histórico
can_messages    — Enviar mensagens
can_duplicate   — Duplicar evento  (off por padrão no template)
can_delete      — Excluir evento   (off por padrão no template)
```

**Admin ignora a tabela `event_access`** — sempre tem acesso total.

---

## 7. Backend — padrões de código

### Estrutura de arquivos
```
src/
  db.js                    ← inicialização + migrations idempotentes
  schema.sql               ← schema base (CREATE TABLE IF NOT EXISTS)
  middleware/
    auth.js                ← requireAuth, requireAdmin, sign()
  utils/
    permissions.js         ← requireRole(), requirePerm(), grantFullAccess(), authorizedEventIds()
    formConfig.js          ← parseFormConfig(), sanitizeAnswer(), extraValueToText()
  routes/
    auth.routes.js         ← /api/auth/*
    users.routes.js        ← /api/users/*
    events.routes.js       ← /api/events/*
    participants.routes.js ← /api/events/:id/participants
    dashboard.routes.js    ← /api/dashboard
    search.routes.js       ← /api/search
```

### Migrations idempotentes (db.js)
```js
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}
function addColumn(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
// Uso:
addColumn('events', 'nova_coluna', 'TEXT');
```

### Middleware de autenticação (auth.js)
```js
// IMPORTANTE: requireAuth recarrega o usuário do banco a cada request.
// Isso garante que bloquear/inativar um usuário tem efeito IMEDIATO,
// sem precisar esperar o JWT expirar.
function requireAuth(req, res, next) {
  // valida JWT → recarrega user do DB → checa status → req.admin = user
}
```

### Rota protegida típica
```js
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePerm } = require('../utils/permissions');

// Só admin e gestor podem criar eventos
router.post('/', requireAuth, requireRole('admin', 'gestor'), async (req, res) => { ... });

// Qualquer usuário com can_edit no evento
router.put('/:id', requireAuth, requirePerm('can_edit'), async (req, res) => { ... });
```

### Log de atividade
```js
function logActivity(actor, action, details) {
  db.prepare('INSERT INTO activity_log (actor, action, details) VALUES (?, ?, ?)')
    .run(actor, action, details || null);
}
```

---

## 8. Schema SQL base

```sql
-- Usuários administrativos
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'operador',
  status        TEXT    NOT NULL DEFAULT 'ativo',
  last_login    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Controle de acesso por evento
CREATE TABLE IF NOT EXISTS event_access (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  event_id          INTEGER NOT NULL,
  can_view          INTEGER NOT NULL DEFAULT 1,
  can_edit          INTEGER NOT NULL DEFAULT 0,
  can_participants  INTEGER NOT NULL DEFAULT 0,
  can_export        INTEGER NOT NULL DEFAULT 0,
  can_history       INTEGER NOT NULL DEFAULT 0,
  can_messages      INTEGER NOT NULL DEFAULT 0,
  can_duplicate     INTEGER NOT NULL DEFAULT 0,
  can_delete        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)
);

-- Log de atividades dos admins
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,
  action     TEXT    NOT NULL,
  details    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

---

## 9. Bugs já corrigidos — não repita

1. **Comparação de string no SQLite**: use sempre aspas simples.
   ```sql
   -- ERRADO (trata "texto" como nome de coluna):
   WHERE notes <> ""
   -- CORRETO:
   WHERE notes <> ''
   ```

2. **Role `editor` foi renomeado para `gestor`**: nunca use `editor` em código novo. Sempre normalize com `normRole()` no frontend ou `normalizeRole()` no backend.

3. **Squash PRs causam conflito no próximo PR**: ao trabalhar com PRs squash-merge, sempre faça `git fetch origin main && git merge origin/main` na branch de trabalho antes de abrir o próximo PR.

4. **Checagem de arrays em campos obrigatórios**: `value !== ''` falha para arrays vazios. Use a função `isFilled(v)`:
   ```js
   function isFilled(v) {
     if (Array.isArray(v)) return v.length > 0;
     return v != null && String(v).trim() !== '';
   }
   ```

5. **JWT não reflete mudanças imediatas**: o `requireAuth` deve sempre recarregar o usuário do banco (não confiar apenas no payload do token), para que bloqueios tenham efeito sem esperar a expiração.

---

## 10. Variáveis de ambiente

```env
JWT_SECRET=string-longa-e-aleatoria
DATA_DIR=/caminho/para/volume/persistente   # opcional; padrão: ./data
PORT=3000                                    # opcional; padrão: 3000
```

---

## 11. Repositório de referência

O sistema **moura-rsvp** (confirmação de presença em eventos) é a implementação de referência de toda esta arquitetura.

- Repositório: `gabrielpertilecasagrande/moura-rsvp`
- Branch principal: `main`
- Copie os arquivos `public/assets/css/styles.css`, `public/assets/js/api.js` e `public/assets/js/shell.js` para o novo sistema para herdar o visual e os utilitários exatos.

---

## 12. Checklist para um novo sistema Moura

- [ ] Copiar `styles.css`, `api.js`, `shell.js` do moura-rsvp
- [ ] Criar `src/db.js` com o padrão de `addColumn` para migrations
- [ ] Criar `src/middleware/auth.js` com `requireAuth` que recarrega do banco
- [ ] Definir roles: `admin`, `gestor`, `operador` (nunca `editor`)
- [ ] Criar seed para o primeiro usuário `admin`
- [ ] Usar `DATA_DIR` via env var para o banco de dados (compatível com Railway/volumes)
- [ ] Usar `JWT_SECRET` via env var
- [ ] Estrutura HTML com `<div class="admin-shell"><div id="shell"></div><main class="main">…</main></div>`
- [ ] Chamar `requireSession()` e `mountShell('chave')` em cada página JS
- [ ] Usar `esc()` para escapar todo HTML dinâmico inserido com `.innerHTML`
