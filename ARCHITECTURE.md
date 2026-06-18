# Arquitetura — Moura RSVP (multi-tenant)

Este documento descreve as decisões de arquitetura do Moura RSVP após a
transição de instância única para um produto multi-tenant comercializável a
organizadores de eventos terceiros.

---

## 1. Visão geral

O Moura RSVP é um serviço Node.js + Express + SQLite com dois públicos:

- **Convidados** — formulário público de RSVP em `/rsvp/:slug` (sem login).
- **Administradores** — painel de gestão em `/admin/*` (login por e-mail/senha).

A partir da migração multi-tenant, cada **organizador** (tenant) tem seu
próprio banco de dados SQLite isolado fisicamente. Não há self-service nem
cobrança: o provisionamento é feito manualmente pelo operador da plataforma.

---

## 2. Decisão central: banco-por-tenant

**Cada organizador tem um arquivo SQLite separado:**

```
DATA_DIR/
  router.db                       índice global de roteamento
  tenants/
    moura/rsvp.db                 banco do tenant "moura"
    acme-eventos/rsvp.db          banco do tenant "acme-eventos"
    ...
  uploads/                        arquivos enviados (global, nomes aleatórios)
  backups/                        snapshots gerados por scripts/backup-tenant.js
```

**Por que banco-por-tenant (e não tabelas com `tenant_id`):**

- Schema pequeno (7 tabelas) → trivial duplicar.
- Isolamento físico completo → LGPD e exportação/exclusão por tenant viram
  uma simples cópia/remoção de arquivo.
- WAL mode já ativo → múltiplos arquivos abertos simultaneamente sem contenção.
- Zero risco de vazamento de dados entre tenants por um `WHERE` esquecido.

**Custo aceito:** migrações de schema precisam iterar todos os bancos
(ver `scripts/run-migrations.js`).

---

## 3. Roteamento de tenant — `router.db`

A URL pública `/rsvp/:slug` **não pode mudar** (há links já distribuídos).
Consequência: slugs de eventos são **globalmente únicos** entre todos os
tenants, garantido centralmente pelo `router.db`.

`router.db` (em `src/router.js`) contém apenas índices de roteamento — nunca
dados de eventos ou participantes:

| Tabela | Função |
|---|---|
| `organizations (id, slug, name, created_at)` | Registro de organizadores |
| `event_slugs (slug PK, tenant_slug)` | Slug do evento → tenant. Resolve o RSVP público |
| `admin_emails (email PK, tenant_slug)` | E-mail do admin → tenant. Permite login sem saber o tenant |

**Como cada tipo de requisição encontra o tenant:**

| Requisição | Resolução do tenant |
|---|---|
| `GET/POST /api/public/events/:slug` | `event_slugs` → abre o banco correto |
| `GET /rsvp/:slug` (HTML) | Estático, sem mudança |
| `POST /api/auth/login` | `admin_emails` pelo e-mail informado |
| Rotas `/api/*` autenticadas | `tenant_slug` embutido no JWT |

---

## 4. Conexão com o banco — Proxy + AsyncLocalStorage

`src/db.js` exporta um **Proxy** que despacha `db.prepare()`, `db.exec()`, etc.
para o banco do tenant da requisição atual, identificado via
`AsyncLocalStorage` (ALS). Isso preserva compatibilidade: todas as rotas que
faziam `const db = require('../db')` continuam **sem alteração**.

```js
runWithDb(tenantSlug, () => {
  // tudo que chamar db.prepare() aqui usa o banco de `tenantSlug`
});
```

- `openTenantDb(slug)` — abre (ou retorna do cache) o banco do tenant,
  aplicando schema + migrações idempotentes. Acesso direto, sem ALS.
- `runWithDb(slug, fn)` — executa `fn()` com o banco no contexto ALS.

O driver é `better-sqlite3` (síncrono), com fallback para `node:sqlite`. A
natureza síncrona torna o uso de ALS seguro, sem condições de corrida entre
requisições concorrentes.

> **Importante:** rotas que usam o proxy `db` precisam ser montadas **abaixo**
> de `requireAuth` (que estabelece o contexto ALS) ou envoltas manualmente em
> `runWithDb(...)`. Sem contexto, o proxy lança um erro explícito.

---

## 5. Autenticação

JWT stateless (Bearer, 12h). O payload inclui `tenant_slug`:

```js
{ id, email, name, role, tenant_slug }
```

`requireAuth` (`src/middleware/auth.js`):
1. Verifica o JWT e lê `tenant_slug`.
2. Recarrega o admin do banco do tenant (bloqueio/inativação têm efeito imediato).
3. Chama `runWithDb(tenantSlug, () => next())` — estabelece o contexto ALS para
   toda a cadeia de middlewares/rotas abaixo.

Papéis: `admin` (acesso total ao tenant) · `gestor` · `operador`.
`event_access` concede permissões granulares por evento a não-admins.

> Tokens emitidos antes da migração (sem `tenant_slug`) são rejeitados com
> mensagem pedindo novo login.

---

## 6. Provisionamento (sem self-service)

`src/provision.js` centraliza a criação de um tenant: valida, registra a
organização no `router.db`, cria o banco do tenant e o primeiro admin
(papel `admin`, ativo), e indexa o e-mail. Faz rollback do registro da
organização se a criação do admin falhar.

Dois caminhos usam a mesma função:

- **CLI (recomendado):**
  ```bash
  node scripts/create-tenant.js \
    --name="ACME Eventos" \
    --admin-email=contato@acme.com \
    --admin-password=senhaForte123 \
    [--slug=acme] [--admin-name="Maria Silva"]
  ```

- **HTTP / painel:** `src/routes/platform.routes.js` expõe
  `GET/POST /api/platform/tenants`, protegido por `PLATFORM_TOKEN`
  (Bearer, comparação em tempo constante). Se `PLATFORM_TOKEN` não estiver
  configurado, as rotas respondem 404 — sem exposição acidental.
  O painel web fica em **`/platform`**.

---

## 7. Migração e operação

| Script | Função |
|---|---|
| `scripts/migrate-to-multitenant.js` | Converte o banco legado `moura-rsvp.db` no tenant inicial. **Copia** (não move) — o original é preservado para rollback. Executado automaticamente no primeiro boot pós-upgrade (`server.js`). |
| `scripts/run-migrations.js` | Aplica schema + migrações de coluna idempotentes em **todos** os bancos `tenants/*/rsvp.db`. Rode após deploys que alteram o schema. |
| `scripts/create-tenant.js` | Provisiona um novo organizador. |
| `scripts/backup-tenant.js` | Backup consistente (`VACUUM INTO`) de um tenant (`--slug=`) ou de todos (`--all`), em `DATA_DIR/backups/`. |

**Seed:** no boot, `server.js` garante (idempotente) a organização e o admin
inicial do tenant padrão (`DEFAULT_TENANT_SLUG`, default `moura`), a partir das
env vars `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## 8. Variáveis de ambiente

| Variável | Default | Função |
|---|---|---|
| `DATA_DIR` | `./data` | Raiz dos bancos, uploads e backups |
| `JWT_SECRET` | `dev-secret` | Assinatura dos tokens de sessão |
| `DEFAULT_TENANT_SLUG` | `moura` | Tenant padrão (seed, rotas de serviço/SSO legadas) |
| `DEFAULT_TENANT_NAME` | `Organização` | Nome da organização padrão |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@moura.com.br` / `moura2026` / `Administrador` | Admin inicial do tenant padrão |
| `PLATFORM_TOKEN` | — | Habilita as rotas/painel de plataforma. Ausente → desativado (404) |
| `PLATFORM_PATH` | `/platform` | Caminho da interface de plataforma. Em produção, use algo imprevisível (ex.: `/plat-x7k29`) |
| `PORT` / `BASE_URL` | `3000` / — | Servidor HTTP |

---

## 9. Limites conhecidos / trabalho futuro

- **Uploads são globais** (`DATA_DIR/uploads/`, nomes aleatórios). Não há
  vazamento entre tenants porque os nomes são imprevisíveis, mas a exclusão de
  um tenant não remove seus uploads. Isolar por pasta de tenant é um próximo passo.
- **Rotas de serviço/SSO legadas** (`/api/auth/sso`, `provision-event`,
  `sync-user`) assumem o tenant padrão via `DEFAULT_TENANT_SLUG`. Se a
  integração com o Moura One precisar atingir múltiplos tenants, será preciso
  escopo de tenant nessas rotas.
- **Cache de conexões** (`dbCache` em `db.js`) cresce com o número de tenants
  e nunca expira. Para muitos tenants, considerar um LRU com fechamento de
  conexões ociosas.
