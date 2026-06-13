# Moura RSVP

Sistema web de confirmação de presença (RSVP) para eventos corporativos da
**Moura Agência de Relações Públicas**.

Cada evento gera **um único link público** (ex.: `/rsvp/forum-cdl-2026`). O
participante acessa, informa seus dados e confirma ou recusa a presença. A
equipe da Moura gerencia tudo por uma área administrativa protegida por login.

Sistema independente, sem integrações externas nesta versão. A arquitetura já
está preparada para evoluir (check-in, QR Code de credenciamento, controle de
acesso), mas essas funções **não** estão implementadas — entrega apenas o RSVP.

---

## Tecnologias

| Camada | Escolha | Por quê |
|---|---|---|
| Servidor | Node.js + Express | Único processo serve API e páginas |
| Banco | SQLite (relacional) via `better-sqlite3` | Zero configuração; migra para PostgreSQL sem reescrever a lógica |
| Frontend | HTML + CSS + JavaScript puro | Sem build, sem framework, leve e fácil de manter |
| Autenticação | JWT + bcrypt | Senha com hash; sessão por token |
| Exportação | ExcelJS (.xlsx) e CSV nativo | Excel e CSV respeitando os filtros aplicados |
| QR Code | qrcode | PNG gerado sob demanda |

---

## Instalação e execução local

Pré-requisito: **Node.js 18 ou superior**.

```bash
# 1. Instalar dependências
npm install

# 2. Criar o arquivo de configuração
cp .env.example .env
#    edite o .env e troque JWT_SECRET e ADMIN_PASSWORD

# 3. Criar o administrador inicial (lê os dados do .env)
npm run seed

# 4. Iniciar o servidor
npm start
```

Acesse:

- Área administrativa: <http://localhost:3000/admin/login.html>
- Login padrão: `admin@moura.com.br` / `moura2026` (definidos no `.env`)

> Para desenvolvimento com recarga automática: `npm run dev`.

---

## Variáveis de ambiente (`.env`)

| Variável | Função |
|---|---|
| `PORT` | Porta do servidor (padrão 3000) |
| `BASE_URL` | **Importante.** URL pública base usada para montar os links e QR Codes dos eventos. Em produção precisa ser o domínio real (ex.: `https://rsvp.seudominio.com.br`), senão os links e QR Codes apontarão para `localhost`. |
| `JWT_SECRET` | Chave de assinatura dos tokens de login. **Troque** por uma string longa e aleatória em produção. |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Administrador criado no primeiro `npm run seed`. |

---

## Publicação (deploy)

O link público precisa estar acessível pela internet, então o sistema deve
rodar em um servidor hospedado. Opções simples (Node.js gerenciado):

- **Railway**, **Render** ou **Fly.io** — conectar o repositório, definir as
  variáveis de ambiente e rodar `npm install && npm run seed` uma vez, depois
  `npm start`.
- Defina **`BASE_URL`** com o domínio final antes de gerar os links/QR Codes.

### Dois pontos de atenção em produção

1. **Banco de dados.** O SQLite grava em `data/moura-rsvp.db`. Em hospedagens
   com disco efêmero (o disco é zerado a cada deploy), use um **volume
   persistente** ou migre para **PostgreSQL**. Como toda a lógica de banco está
   isolada em `src/db.js`, a migração não afeta as rotas.
2. **Imagens enviadas.** Capas e logos ficam em `uploads/`. No mesmo cenário de
   disco efêmero, use um **volume persistente** ou um serviço de
   armazenamento de objetos (ex.: S3) para não perder os arquivos.

---

## Estrutura do projeto

```
moura-rsvp/
├── server.js                 # Inicializa o Express e monta as rotas
├── src/
│   ├── db.js                 # Conexão com o banco (camada isolada/portável)
│   ├── schema.sql            # Esquema relacional (tabelas e índices)
│   ├── seed.js               # Cria o administrador inicial
│   ├── middleware/auth.js    # Geração e verificação de token (JWT)
│   ├── utils/
│   │   ├── normalize.js      # Normaliza nomes (base da deduplicação)
│   │   └── slug.js           # Gera URLs amigáveis e únicas
│   └── routes/
│       ├── auth.routes.js        # Login do administrador
│       ├── dashboard.routes.js   # Indicadores da tela inicial
│       ├── events.routes.js      # CRUD de eventos, upload, QR Code
│       ├── participants.routes.js# Painel, filtros, auditoria, exportação
│       └── public.routes.js      # Página pública e envio de RSVP
├── public/
│   ├── admin/                # Telas administrativas (login, dashboard, evento)
│   ├── rsvp/                 # Página pública de confirmação
│   └── assets/               # CSS, JavaScript e o logo da Moura
├── uploads/                  # Imagens enviadas (capas e logos)
└── data/                     # Banco SQLite (criado em tempo de execução)
```

---

## Modelo de dados

- **admins** — usuários da área administrativa.
- **events** — dados do evento, mensagens personalizadas, status, prazo,
  configuração do formulário (`form_config`) e `expected_guests` (público
  esperado, usado no cálculo de pendentes).
- **participants** — uma linha por pessoa por evento. A coluna
  `name_normalized` com restrição `UNIQUE(event_id, name_normalized)` é o que
  evita duplicidade e dispara a atualização do registro existente.
- **audit_log** — histórico de cada criação e alteração de resposta (data,
  ação, resposta anterior e nova).

A tabela `participants` já contém as colunas reservadas `qr_token` e
`checked_in_at`, **não utilizadas nesta versão**, deixadas prontas para o
módulo futuro de check-in/credenciamento.

---

## Como a alteração de resposta funciona

Não há link individual por convidado — o evento tem um único link. Ao enviar o
formulário, o sistema normaliza o nome (ignora maiúsculas/minúsculas, acentos e
espaços extras). Se já existir um participante com aquele nome no mesmo evento,
os dados e a resposta são **atualizados** (e registrados na auditoria), em vez
de criar uma duplicata. O participante vê a mensagem:
*"Encontramos uma resposta anterior e seus dados foram atualizados."*

---

## Preparação para o futuro (não implementado)

A estrutura foi desenhada para receber, sem reescrita:

- **Check-in / QR Code de credenciamento** — colunas `qr_token` e
  `checked_in_at` já existem; o QR atual aponta para o link público, mas pode
  passar a identificar o participante.
- **Credenciamento e controle de acesso** — a camada de banco isolada e o
  modelo relacional permitem novas tabelas (sessões, acessos) sem impacto nas
  rotas atuais.
- **Lista de convidados (invitees)** — permitiria um conceito real de
  "pendentes" por pessoa (hoje calculado por `expected_guests`).
