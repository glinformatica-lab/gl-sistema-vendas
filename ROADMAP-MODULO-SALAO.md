# 💇 ROADMAP — MÓDULO SALÃO GL SISTEMA

**Data:** 01/09/2026
**Cliente piloto:** [Nome da dona do salão]
**Estratégia:** Módulo dentro do sistema atual, ativado por feature toggle
**UX:** SIMPLES — dona tem pouca familiaridade com computador

---

## 🎯 RESUMO DO NEGÓCIO

```
🏢 SALÃO (a dona)
   ├─ Aluga espaço pras cabeleireiras parceiras
   ├─ Cabeleireira paga 10% dos serviços (locação do espaço)
   ├─ Salão paga comissão pra cabeleireira sobre PRODUTOS vendidos
   ├─ TODAS as vendas passam pelo caixa do salão
   ├─ Paga cabeleireiras MENSALMENTE (fechamento único)
   ├─ Cabeleireiras pedem VALES durante o mês (adiantamento)
   └─ Precisa de relatório fechamento por cabeleireira

👥 USUÁRIO
   └─ Só a dona (SEM multiusuário no início)

📅 AGENDA
   ├─ Calendário visual (dia/semana)
   ├─ Duração livre por atendimento (não padronizada)
   └─ Só a dona/recepcionista agenda

💰 CUSTOS
   ├─ Taxa maquininha FIXA por tipo (dinheiro=0%, PIX=X%, débito=Y%, crédito=Z%)
   ├─ Custo dos produtos usados no atendimento (baixa estoque)
   └─ Relatórios: por serviço, por atendimento, geral do mês
```

---

## 📊 O QUE JÁ EXISTE E VAI SER REUSADO

```
✅ Sistema multi-tenant (empresa_id)
✅ Autenticação (JWT)
✅ Tabela produtos (com estoque, preço, custo)
✅ Tabela clientes (nome, telefone, endereço)
✅ Tabela vendas + itens (padrão de vendas)
✅ Feature toggle pattern (moduloAmbientes, moduloFiscal)
✅ Pattern de rotas backend (routes/*.js)
✅ Pattern de menus (menu-grupo + submenu)
✅ Paginação server-side (aprendemos no fiscal)
✅ Padrão de modais e formulários
```

---

## 🏗️ NOVA ESTRUTURA DE DADOS

### FASE 0 — Feature toggle
```sql
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_salao BOOLEAN DEFAULT FALSE;
```

### FASE 1 — Cadastros básicos

```sql
-- Profissionais (cabeleireiras parceiras)
CREATE TABLE IF NOT EXISTS profissionais (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT,
  cpf TEXT,
  pix TEXT,                    -- chave PIX pra pagamento mensal
  data_inicio DATE,
  percentual_espaco NUMERIC DEFAULT 10, -- % que profissional PAGA sobre serviços
  percentual_comissao_produto NUMERIC DEFAULT 0, -- % que profissional GANHA sobre venda de produto
  observacoes TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_profissionais_empresa ON profissionais(empresa_id, ativo);

-- Serviços (catálogo)
CREATE TABLE IF NOT EXISTS servicos_salao (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,          -- "Corte feminino", "Coloração", "Escova"
  preco_padrao NUMERIC,        -- pode ser sobrescrito no atendimento
  duracao_padrao_min INTEGER,  -- opcional, ajuda no agendamento
  produtos_receita JSONB,      -- [{produto_id, qtd_padrao}] - baixa automática
  categoria TEXT,              -- "cabelo", "unha", "estética", etc
  ativo BOOLEAN DEFAULT TRUE,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_servicos_empresa ON servicos_salao(empresa_id, ativo);

-- Configuração de taxas (por empresa)
CREATE TABLE IF NOT EXISTS taxas_maquininha (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  forma_pagamento TEXT NOT NULL, -- 'dinheiro'|'pix'|'debito'|'credito'
  taxa_percentual NUMERIC DEFAULT 0,
  UNIQUE(empresa_id, forma_pagamento)
);
```

### FASE 2 — Agenda

```sql
CREATE TABLE IF NOT EXISTS agendamentos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  cliente_id INTEGER REFERENCES clientes(id),
  cliente_nome_avulso TEXT,    -- se não cadastrado
  cliente_telefone_avulso TEXT,
  data DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  servicos_previstos JSONB,    -- [{servico_id, nome, preco}]
  status TEXT DEFAULT 'agendado',
    -- 'agendado' | 'confirmado' | 'atendido' | 'faltou' | 'cancelado'
  atendimento_id INTEGER,      -- vira null → id quando dona faz o atendimento
  observacoes TEXT,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agendamentos_data ON agendamentos(empresa_id, data);
CREATE INDEX idx_agendamentos_prof ON agendamentos(profissional_id, data);
```

### FASE 3 — Atendimentos (vendas do salão)

```sql
CREATE TABLE IF NOT EXISTS atendimentos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  cliente_id INTEGER REFERENCES clientes(id),
  cliente_nome TEXT,           -- snapshot do nome
  data DATE NOT NULL,
  hora TIME,
  
  -- Serviços prestados
  servicos JSONB,              -- [{servico_id, nome, preco, custo_produtos}]
  subtotal_servicos NUMERIC DEFAULT 0,
  
  -- Produtos vendidos (não é o mesmo que produtos usados)
  produtos_vendidos JSONB,     -- [{produto_id, nome, qtd, preco, comissao_pct, comissao_valor}]
  subtotal_produtos NUMERIC DEFAULT 0,
  
  -- Produtos consumidos no atendimento (tinta, oxigenada, etc) - dá baixa em estoque
  produtos_usados JSONB,       -- [{produto_id, nome, qtd, custo_unit}]
  custo_produtos_usados NUMERIC DEFAULT 0,
  
  -- Totais
  desconto NUMERIC DEFAULT 0,
  total_bruto NUMERIC DEFAULT 0,
  
  -- Pagamento e taxa
  forma_pagamento TEXT,        -- 'dinheiro'|'pix'|'debito'|'credito'
  taxa_maquininha_pct NUMERIC DEFAULT 0,  -- snapshot da taxa aplicada
  valor_taxa_maquininha NUMERIC DEFAULT 0,
  total_liquido NUMERIC DEFAULT 0,        -- total_bruto - taxa
  
  -- Divisão do valor
  valor_espaco_salao NUMERIC DEFAULT 0,     -- 10% do subtotal_servicos
  valor_comissao_profissional NUMERIC DEFAULT 0, -- comissão dos produtos vendidos
  valor_liquido_profissional NUMERIC DEFAULT 0,  -- serviços - taxa 10% + comissão produto
  valor_liquido_salao NUMERIC DEFAULT 0,          -- taxa 10% + produtos - comissão prof
  
  observacoes TEXT,
  cancelado BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_atendimentos_data ON atendimentos(empresa_id, data DESC);
CREATE INDEX idx_atendimentos_prof ON atendimentos(profissional_id, data);
```

### FASE 4 — Vales e fechamento mensal

```sql
CREATE TABLE IF NOT EXISTS vales_profissional (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  data DATE NOT NULL,
  valor NUMERIC NOT NULL,
  observacao TEXT,
  fechamento_id INTEGER,       -- null até fechar o mês
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vales_prof ON vales_profissional(profissional_id, data);

CREATE TABLE IF NOT EXISTS fechamentos_mensais (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  mes INTEGER NOT NULL,        -- 1-12
  ano INTEGER NOT NULL,
  
  -- Ganhos brutos
  total_servicos NUMERIC DEFAULT 0,       -- soma dos serviços atendidos
  total_produtos_comissao NUMERIC DEFAULT 0, -- comissões de produtos vendidos
  
  -- Descontos
  total_taxa_espaco NUMERIC DEFAULT 0,    -- 10% dos serviços
  total_vales NUMERIC DEFAULT 0,          -- vales tirados no mês
  
  -- Líquido a pagar
  valor_liquido NUMERIC DEFAULT 0,
  
  -- Pagamento
  status TEXT DEFAULT 'aberto', -- 'aberto' | 'fechado' | 'pago'
  pago_em DATE,
  forma_pagamento TEXT,
  observacoes TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, profissional_id, mes, ano)
);
```

---

## 🎨 TELAS QUE VAMOS CRIAR

### Menu novo "💇 Salão" (feature-salao)

```
📁 Salão
├─ 📅 Agenda            (calendário visual)
├─ 💼 Atendimentos      (novo atendimento + histórico)
├─ 👥 Profissionais     (cadastro de cabeleireiras)
├─ ✂️ Serviços          (catálogo de serviços)
├─ 💵 Vales             (registrar adiantamentos)
└─ 📊 Fechamento Mensal (fecha + gera relatório)
```

### Detalhamento das telas

#### 1️⃣ 📅 Agenda
- Calendário estilo Google Calendar
- Visões: **Dia** (colunas por profissional) | **Semana** | **Mês**
- Filtro por profissional (dropdown)
- Clica num horário vazio → modal "Novo Agendamento"
- Clica num agendamento → modal com opções: Editar / Confirmar / Iniciar Atendimento / Marcar como Faltou / Cancelar
- Cores por status: azul=agendado, verde=confirmado, cinza=atendido, vermelho=faltou
- Arrastar bloco pra remarcar horário (drag & drop)

#### 2️⃣ 💼 Atendimentos
- Botão grande "➕ Novo Atendimento" no topo
- Modal em passos (wizard, pra ser SIMPLES):
  ```
  Passo 1: Profissional + Cliente + Data/hora
  Passo 2: Selecionar Serviços (com produtos usados automaticamente)
  Passo 3: Adicionar Produtos vendidos (opcional)
  Passo 4: Forma de pagamento + confirmar totais
  ```
- Cada passo tem botões grandes, poucos campos por tela
- Ao finalizar: mostra tela de sucesso com "Ganho do salão: R$ X | Ganho da profissional: R$ Y"
- Lista de atendimentos abaixo com filtros (data, profissional, cliente)

#### 3️⃣ 👥 Profissionais
- Lista com: nome, telefone, % espaço, % comissão produto, ativo
- Botão "+ Nova Profissional"
- Modal com todos os campos
- Ver "Perfil" mostra: total do mês, últimos atendimentos, vales tirados

#### 4️⃣ ✂️ Serviços
- Lista com: nome, categoria, preço padrão, duração
- Cadastro tem opção de definir "receita" (produtos que consome)
- Ex: "Coloração completa" → 50ml tinta + 30ml oxigenada
- Isso ajuda a calcular custo e baixar estoque

#### 5️⃣ 💵 Vales
- Lista de vales tirados por profissional
- Filtros: profissional, período
- Botão "+ Registrar Vale"
- Modal simples: profissional, valor, data, observação
- Não permite editar/apagar vale já incluído em fechamento fechado

#### 6️⃣ 📊 Fechamento Mensal
- Seleciona: profissional + mês/ano
- Tela mostra:
  ```
  📊 Fechamento: Maria Silva — Setembro 2026
  
  💰 GANHOS
     Serviços atendidos (35): ...................... R$ 3.500,00
     Comissão de produtos vendidos: ................ R$   150,00
     ────────────────────────────────────────────────────────────
     Total bruto: .................................. R$ 3.650,00
  
  📉 DESCONTOS
     Taxa de espaço (10% dos serviços): ............ R$   350,00
     Vales tirados no mês (3): ..................... R$   500,00
     ────────────────────────────────────────────────────────────
     Total descontos: .............................. R$   850,00
  
  ✅ LÍQUIDO A PAGAR: ............................... R$ 2.800,00
  
  [Ver detalhamento] [Imprimir PDF] [Marcar como pago]
  ```
- Botão "Ver detalhamento" abre lista completa: cada atendimento + cada vale
- Ao marcar como pago, vales ficam "travados" e fechamento vira "pago"
- Também há visão consolidada: fechamento de TODAS as profissionais do mês

---

## 🛠️ IMPLEMENTAÇÃO POR FASES

### 📋 FASE 0 — Infraestrutura (1 dia)
- Migration v42: adiciona `modulo_salao` em empresas
- Feature toggle no frontend (`.feature-salao`)
- Menu "💇 Salão" (escondido por padrão)
- Ativa manualmente pra 1 empresa piloto

### 📋 FASE 1 — Cadastros base (3-5 dias)
- Migration v43: profissionais, servicos_salao, taxas_maquininha
- Backend: rotas CRUD dos 3
- Frontend: 3 páginas de cadastro
- Testes: cadastrar 3 profissionais, 10 serviços

### 📋 FASE 2 — Agenda (1 semana)
- Migration v44: agendamentos
- Backend: CRUD + endpoints por data/profissional
- Frontend: calendário (usa biblioteca? ou custom?)
- Testes: agendar, remarcar, cancelar

### 📋 FASE 3 — Atendimentos (2 semanas)
- Migration v45: atendimentos
- Backend: rota principal (POST atendimento com cálculos)
- Backend: baixa em estoque (produtos_usados + produtos_vendidos)
- Frontend: wizard de 4 passos
- Cálculos automáticos: taxa maquininha, 10%, comissões
- Integração: se veio de agendamento, atualiza status
- Testes: atendimento simples, com desconto, várias formas pgto

### 📋 FASE 4 — Vales + Fechamento (3-5 dias)
- Migration v46: vales_profissional + fechamentos_mensais
- Backend: CRUD vales + endpoint de fechamento
- Frontend: telas de vale e fechamento
- Impressão PDF do fechamento
- Testes: fluxo completo mensal

### 📋 FASE 5 — Relatórios e refinos (1 semana)
- Dashboard salão: atendimentos hoje, valor, agendamentos futuros
- Relatório: faturamento por período (por prof, por serviço, geral)
- Relatório: custos operacionais (produtos usados, taxas maquininha)
- Alertas: agendamentos próximos (hoje/amanhã)
- Melhorias de UX baseadas no feedback da dona

---

## ⏰ ESTIMATIVA TOTAL

```
FASE 0 — Infraestrutura        1 dia
FASE 1 — Cadastros base        5 dias
FASE 2 — Agenda                7 dias
FASE 3 — Atendimentos         14 dias
FASE 4 — Vales + Fechamento    5 dias
FASE 5 — Relatórios + refinos  7 dias
─────────────────────────────────────
TOTAL:                    ~ 6-8 semanas
```

Se trabalharmos em módulo por semana, tem uma versão utilizável em ~4 semanas (até Fase 3).

---

## 🎯 UX SIMPLIFICADA — decisões pra dona não se perder

```
✅ Botões GRANDES (min 44x44px pra dedo em mobile)
✅ Poucos campos por tela (usar wizard/passos)
✅ Cores intuitivas (verde=ok, vermelho=alerta)
✅ Confirmação em ações críticas ("Tem certeza?")
✅ Mensagens claras em português coloquial
   → "Atendimento salvo! Maria vai receber R$ 45,00 desse serviço"
✅ Home Dashboard com "O que fazer agora?"
   → "3 agendamentos hoje" | "Fechamento de outubro pendente"
✅ Impressão fácil (botão em todo relatório)
✅ Buscar clientes por nome/telefone (não por código)
✅ Suporte mobile (dona vai usar celular também)
```

---

## 🚨 PONTOS DE ATENÇÃO

### Estoque compartilhado
- Produtos vão SUMIR do estoque quando usados no salão
- Cuidado com conflito: se produto tem estoque 5, e sistema vende 3 e usa 3 = negativo
- Solução: bloquear atendimento se estoque insuficiente OU permitir negativo (dona escolhe)

### Fechamento fechado é imutável
- Uma vez marcado como "pago", NÃO permitir editar vales/atendimentos do período
- Se precisar corrigir: criar "ajuste no próximo fechamento"

### Precisão de valores
- Todos os cálculos com NUMERIC no banco (não float)
- Formatação BR (vírgula decimal, R$ 1.234,56)

### Backup e histórico
- Alterações em atendimentos passados devem ser logadas
- Se profissional for excluída, atendimentos ficam (soft delete)

---

## 📞 PRA CLIENTE

### Modelo comercial sugerido
```
Plano Salão: R$ 99-149/mês
  ├─ Sistema web + mobile
  ├─ Até 5 profissionais
  ├─ Agendamentos ilimitados
  └─ Suporte por WhatsApp

Add-on: WhatsApp Business API (envio automático)
  └─ +R$ 50/mês (usa API paga)
```

### Diferenciais vs concorrentes
- Booksy/Fresha: R$ 200+/mês, mais complexos
- Vagalume: mais simples, mas sem estoque
- **GL Salão**: preço acessível + estoque integrado + relatórios

---

## 🎯 QUANDO ME CHAMAR

**Quando a cliente estiver pronta pra começar**, me manda:

> "Vamos começar o módulo salão!
> Cliente: [nome], salão [nome], CNPJ [x]
> Profissionais: [quantas]
> Vamos pela Fase 0 (infraestrutura)."

E aí a gente executa fase por fase.

---

## ✅ CHECKLIST PRÉ-IMPLEMENTAÇÃO

Antes de começar, ter em mãos:

- [ ] Nome e CNPJ do salão
- [ ] Lista das profissionais parceiras (com % que cada uma paga/ganha)
- [ ] Lista dos serviços com preços
- [ ] Taxas de maquininha (crédito, débito, PIX)
- [ ] Lista de produtos (se ainda não estão no sistema)
- [ ] Como ela quer receber pagamento (PIX? Transferência?)
- [ ] Ela vai usar celular ou computador?
- [ ] Alguma profissional vai ter acesso ao sistema? (senão, só a dona)

---

**Última atualização:** 01/09/2026
**Próxima revisão:** Quando cliente confirmar início da implementação
