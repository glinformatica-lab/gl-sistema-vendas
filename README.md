# Sistema de Vendas — Multi-tenant

Sistema de vendas/estoque/financeiro para múltiplas empresas, cada uma com seus próprios usuários e dados isolados. Backend em Node.js + Express + PostgreSQL, frontend em HTML/JS puro.

## Estrutura

```
sistema-vendas/
└── backend/
    ├── server.js           # Servidor Express
    ├── package.json
    ├── db/                 # Banco de dados
    │   ├── schema.sql      # Tabelas (multi-tenant via empresa_id)
    │   ├── index.js        # Pool de conexão pg
    │   └── init.js         # Script para criar tabelas
    ├── middleware/
    │   └── auth.js         # JWT + bcrypt
    ├── routes/             # Endpoints da API
    │   ├── auth.js         # /api/auth/*
    │   ├── produtos.js     # /api/produtos
    │   ├── clientes.js     # /api/clientes
    │   ├── fornecedores.js # /api/fornecedores
    │   ├── vendas.js       # /api/vendas
    │   ├── entradas.js     # /api/entradas
    │   ├── contas-pagar.js
    │   └── contas-receber.js
    ├── public/             # Frontend (HTML + JS)
    │   ├── login.html      # Tela de login/cadastro
    │   └── index.html      # Sistema completo
    └── .env.example
```

## Rodar localmente

### 1. Pré-requisitos

- Node.js 18+ instalado
- PostgreSQL rodando local OU conta no Render (gratuito)

### 2. Instalar dependências

```bash
cd backend
npm install
```

### 3. Configurar variáveis

```bash
cp .env.example .env
```

Edite `.env` e preencha:
- `DATABASE_URL` — URL do Postgres (`postgres://user:pass@host:porta/banco`)
- `JWT_SECRET` — string aleatória de 32+ caracteres (`openssl rand -hex 32` ou inventa qualquer texto bem longo)

### 4. Criar as tabelas

```bash
npm run init-db
```

### 5. Rodar o servidor

```bash
npm start          # produção
npm run dev        # com auto-reload
```

Abra `http://localhost:3000` — vai abrir a tela de login.

### 6. Primeiro acesso

Clique em "Cadastrar minha empresa", preencha os dados — o sistema cria a empresa e te loga automaticamente como admin.

---

## Deploy no Render

### Passo 1 — Subir código pro GitHub

```bash
cd sistema-vendas
git init
git add .
git commit -m "Sistema de Vendas — primeira versão"
# Crie um repositório novo no github.com (sem README) e:
git remote add origin git@github.com:SEU-USUARIO/sistema-vendas.git
git branch -M main
git push -u origin main
```

### Passo 2 — Criar banco PostgreSQL no Render

1. Em https://dashboard.render.com, clique em **+ New** → **PostgreSQL**
2. Nome: `sistema-vendas-db`
3. Region: a mais próxima (ex.: Oregon)
4. Plan: **Free** (90 dias grátis, depois precisa upgrade pra ~$7/mês)
5. Clique em **Create Database**
6. Aguarde o status virar "Available" (~2 min)
7. Na página do banco, copie a **Internal Database URL** (vai usar no próximo passo)

### Passo 3 — Criar Web Service no Render

1. **+ New** → **Web Service**
2. Conecte sua conta GitHub se ainda não conectou
3. Selecione o repositório `sistema-vendas`
4. Configure:
   - **Name**: `sistema-vendas` (vai virar `sistema-vendas.onrender.com`)
   - **Region**: a mesma do banco
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (dorme após 15min ociosos, demora ~30s pra acordar)
5. **Environment Variables** (clique em "Add"):
   - `DATABASE_URL` = (cole a Internal Database URL do passo 2)
   - `JWT_SECRET` = (string aleatória — use `openssl rand -hex 32` ou clique em "Generate" no Render)
   - `NODE_ENV` = `production`
6. Clique em **Create Web Service**

### Passo 4 — Inicializar o banco no Render

Após o primeiro deploy terminar:

1. Na página do Web Service, vá em **Shell**
2. Rode:
   ```bash
   npm run init-db
   ```
3. Deve aparecer: `✓ Banco de dados inicializado com sucesso.`

Pronto! Acesse `https://sistema-vendas.onrender.com` (ou o nome que escolheu).

---

## Sobre os planos gratuitos do Render

- **Web Service Free**: dorme após 15min ociosos. Primeira requisição depois disso demora ~30s. Para um sistema de uso esporádico, funciona. Para uso contínuo, suba pra Starter ($7/mês).
- **PostgreSQL Free**: válido por 90 dias. Depois disso, é necessário pagar (~$7/mês para o plano básico) ou migrar pra outro provedor (ex: Neon.tech, Supabase, ambos com tier gratuito permanente).

**Alternativa gratuita permanente para o banco:** crie no [Neon.tech](https://neon.tech) ou [Supabase](https://supabase.com) — copie a connection string e use como `DATABASE_URL` no Render. O Web Service do Render fica grátis (com a limitação do sleep).

---

## Status do projeto

✅ **Backend:** completo, com 18 testes integrados passando (auth, multi-tenancy, transações de venda/entrada/estoque, validações)

✅ **Frontend:** todos os formulários integrados com a API:
- Login e cadastro de empresa
- Cadastro/edição de cliente, fornecedor, produto
- Nova Venda (com transação completa via API)
- Entrada Sem NF e Com NF
- Lançamento manual de Conta a Pagar/Receber
- Quitar/Receber/Editar/Excluir contas
- Histórico de movimentação por produto
- Logout

Pronto para deploy!

## Endpoints da API

Todas exigem header `Authorization: Bearer <token>` (exceto `/api/auth/*`).

### Auth
- `POST /api/auth/registrar-empresa` — `{ empresa, cnpj?, nome, email, senha }`
- `POST /api/auth/login` — `{ email, senha }`
- `GET /api/auth/me`

### Clientes / Fornecedores
- `GET    /api/clientes` `/api/fornecedores`
- `POST   /api/clientes` `/api/fornecedores`
- `PUT    /api/clientes/:id` `/api/fornecedores/:id`
- `DELETE /api/clientes/:id` `/api/fornecedores/:id`

### Produtos
- `GET    /api/produtos`
- `POST   /api/produtos` — `{ codigo?, nome, categoria?, fornecedor, estoque?, precoCusto, precoVenda }`
- `PUT    /api/produtos/:id` — não altera estoque (use entradas/saídas)
- `GET    /api/produtos/:id/movimentacoes`

### Vendas
- `GET    /api/vendas`
- `POST   /api/vendas` — `{ data, cliente, itens:[{produto,qtd,preco}], desconto?, pagamento, parcelamento?:{n,dataPrimeira,intervalo}, obs? }` (transação: dá baixa no estoque, gera contas a receber)
- `DELETE /api/vendas/:id` (reverte estoque e contas pendentes)

### Entradas
- `GET    /api/entradas`
- `POST   /api/entradas` — sem-nf ou com-nf (transação: incrementa estoque, atualiza preço, gera conta a pagar se à prazo)
- `DELETE /api/entradas/:id`

### Contas a Pagar / Receber
- `GET    /api/contas-pagar`
- `POST   /api/contas-pagar` — lançamento manual com parcelamento
- `PUT    /api/contas-pagar/:id` (apenas manuais)
- `POST   /api/contas-pagar/:id/quitar`
- `DELETE /api/contas-pagar/:id` (apenas manuais)
- (idem para `/api/contas-receber` com `/receber` em vez de `/quitar`)
