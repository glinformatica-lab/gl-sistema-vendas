-- Schema multi-tenant: toda tabela de dados tem empresa_id
-- e os índices/queries sempre filtram por ela.

CREATE TABLE IF NOT EXISTS empresas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'vendedor'
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (empresa_id, email)
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  doc TEXT,
  telefone TEXT,
  cidade TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fornecedores_empresa ON fornecedores(empresa_id);

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  doc TEXT,
  telefone TEXT,
  cep TEXT,
  endereco TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  e_tambem_fornecedor BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON clientes(empresa_id);

CREATE TABLE IF NOT EXISTS produtos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT,
  nome TEXT NOT NULL,
  categoria TEXT,
  fornecedor TEXT,
  estoque NUMERIC(14,3) DEFAULT 0,
  preco_custo NUMERIC(14,2) DEFAULT 0,
  preco_venda NUMERIC(14,2) DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (empresa_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_produtos_empresa ON produtos(empresa_id);

CREATE TABLE IF NOT EXISTS entradas (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- 'sem-nf' | 'com-nf'
  data DATE NOT NULL,
  fornecedor TEXT,
  doc TEXT,
  numero TEXT,
  serie TEXT,
  chave TEXT,
  data_emissao DATE,
  data_entrada DATE,
  natureza TEXT,
  cnpj TEXT,
  itens JSONB NOT NULL DEFAULT '[]',
  total_geral NUMERIC(14,2) DEFAULT 0,
  total_produtos NUMERIC(14,2) DEFAULT 0,
  frete NUMERIC(14,2) DEFAULT 0,
  seguro NUMERIC(14,2) DEFAULT 0,
  outras NUMERIC(14,2) DEFAULT 0,
  desconto NUMERIC(14,2) DEFAULT 0,
  total_nf NUMERIC(14,2) DEFAULT 0,
  pagamento TEXT,
  vencimento DATE,
  obs TEXT,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entradas_empresa ON entradas(empresa_id);

CREATE TABLE IF NOT EXISTS vendas (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  cliente TEXT NOT NULL,
  itens JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(14,2) DEFAULT 0,
  desconto NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  pagamento TEXT,
  parcelas JSONB NOT NULL DEFAULT '[]',
  obs TEXT,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendas_empresa ON vendas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(empresa_id, data);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_codigo TEXT,
  produto_nome TEXT NOT NULL,
  data DATE NOT NULL,
  tipo TEXT NOT NULL, -- 'entrada' | 'saida'
  qtd NUMERIC(14,3) NOT NULL,
  origem TEXT,
  observacao TEXT,
  entrada_id INTEGER REFERENCES entradas(id) ON DELETE SET NULL,
  venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_empresa ON movimentacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_produto ON movimentacoes(empresa_id, produto_codigo);

CREATE TABLE IF NOT EXISTS contas_pagar (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fornecedor TEXT,
  descricao TEXT NOT NULL,
  categoria TEXT,
  valor NUMERIC(14,2) NOT NULL,
  vencimento DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pendente', -- 'Pendente' | 'Paga'
  data_pagamento DATE,
  origem TEXT, -- 'manual' | null (vinda de entrada)
  obs TEXT,
  entrada_id INTEGER REFERENCES entradas(id) ON DELETE SET NULL,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_empresa ON contas_pagar(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_status ON contas_pagar(empresa_id, status);

CREATE TABLE IF NOT EXISTS contas_receber (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente TEXT NOT NULL,
  descricao TEXT NOT NULL,
  categoria TEXT,
  valor NUMERIC(14,2) NOT NULL,
  vencimento DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pendente', -- 'Pendente' | 'Recebida'
  data_recebimento DATE,
  origem TEXT,
  obs TEXT,
  venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
  criada_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contas_receber_empresa ON contas_receber(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contas_receber_status ON contas_receber(empresa_id, status);
