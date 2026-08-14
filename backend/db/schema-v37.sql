-- Migration v37: Cotações
-- Fluxo: Lista Compras → Cotação (sem preços) → Enviar p/ vários fornecedores
--        → Preencher preços → Comparar → Escolher vencedores → Ordens de Compra

CREATE TABLE IF NOT EXISTS cotacoes (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'recebendo', 'decidindo', 'fechada', 'cancelada')),
  observacao TEXT,
  prazo_resposta DATE,           -- opcional: até quando fornecedores devem responder
  data_criacao TIMESTAMP DEFAULT NOW(),
  data_fechamento TIMESTAMP,
  data_cancelamento TIMESTAMP,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por_nome VARCHAR(120),
  fechado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fechado_por_nome VARCHAR(120),
  UNIQUE(empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS cotacoes_itens (
  id SERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome VARCHAR(200) NOT NULL,
  produto_codigo VARCHAR(50),
  referencia VARCHAR(50),
  marca VARCHAR(120),
  quantidade NUMERIC(14,2) NOT NULL,
  observacao TEXT,
  -- Origens (quais itens da lista_compras vieram)
  origens JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS cotacoes_fornecedores (
  id SERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
  fornecedor_nome VARCHAR(200) NOT NULL, -- cache
  status VARCHAR(20) DEFAULT 'aguardando'
    CHECK (status IN ('aguardando', 'respondeu', 'declinou')),
  prazo_entrega_dias INTEGER,    -- fornecedor informa quantos dias entrega
  condicao_pagamento VARCHAR(200), -- ex: "30/60/90", "à vista", "pix"
  observacao TEXT,
  respondeu_em TIMESTAMP,
  UNIQUE(cotacao_id, fornecedor_id)
);

CREATE TABLE IF NOT EXISTS cotacoes_respostas (
  id SERIAL PRIMARY KEY,
  cotacao_id INTEGER NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  cotacao_item_id INTEGER NOT NULL REFERENCES cotacoes_itens(id) ON DELETE CASCADE,
  cotacao_fornecedor_id INTEGER NOT NULL REFERENCES cotacoes_fornecedores(id) ON DELETE CASCADE,
  preco_unitario NUMERIC(14,2),  -- pode ser NULL se fornecedor não cotou este item
  observacao TEXT,
  vencedor BOOLEAN DEFAULT FALSE, -- marcado quando comprador escolhe este fornecedor pra este item
  UNIQUE(cotacao_item_id, cotacao_fornecedor_id)
);

-- Rastreia origem: ordem_compra criada a partir de qual cotação
ALTER TABLE ordens_compra ADD COLUMN IF NOT EXISTS cotacao_id INTEGER
  REFERENCES cotacoes(id) ON DELETE SET NULL;

-- Rastreia: item da lista_compras já foi cotado?
ALTER TABLE lista_compras ADD COLUMN IF NOT EXISTS cotacao_id INTEGER
  REFERENCES cotacoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cotacoes_empresa ON cotacoes(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_cot ON cotacoes_itens(cotacao_id);
CREATE INDEX IF NOT EXISTS idx_cotacoes_forn_cot ON cotacoes_fornecedores(cotacao_id);
CREATE INDEX IF NOT EXISTS idx_cotacoes_resp_cot ON cotacoes_respostas(cotacao_id);
CREATE INDEX IF NOT EXISTS idx_cotacoes_resp_item ON cotacoes_respostas(cotacao_item_id);
CREATE INDEX IF NOT EXISTS idx_ordens_compra_cot ON ordens_compra(cotacao_id);
CREATE INDEX IF NOT EXISTS idx_lista_compras_cot ON lista_compras(cotacao_id) WHERE cotacao_id IS NOT NULL;
