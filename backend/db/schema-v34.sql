-- Migration v34: Ordens de Compra
-- Comprador agrupa itens de vários orçamentos numa única ordem por fornecedor

CREATE TABLE IF NOT EXISTS ordens_compra (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
  fornecedor_nome VARCHAR(200), -- cache pra caso fornecedor seja excluído
  status VARCHAR(20) NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviada', 'concluida', 'cancelada')),
  data_criacao TIMESTAMP DEFAULT NOW(),
  data_envio TIMESTAMP,
  data_conclusao TIMESTAMP,
  data_cancelamento TIMESTAMP,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por_nome VARCHAR(120),
  enviada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  enviada_por_nome VARCHAR(120),
  observacao TEXT,
  valor_estimado NUMERIC(14,2) DEFAULT 0,
  UNIQUE(empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS ordens_compra_itens (
  id SERIAL PRIMARY KEY,
  ordem_compra_id INTEGER NOT NULL REFERENCES ordens_compra(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome VARCHAR(200) NOT NULL,
  produto_codigo VARCHAR(50),
  referencia VARCHAR(50),
  quantidade NUMERIC(14,2) NOT NULL,
  preco_unitario NUMERIC(14,2) DEFAULT 0,
  observacao TEXT,
  -- Origens (quais orçamentos contribuíram para este item, em JSON)
  origens JSONB DEFAULT '[]'::jsonb
);

-- FK inversa: cada item da lista_compras pode estar vinculado a uma ordem
ALTER TABLE lista_compras ADD COLUMN IF NOT EXISTS ordem_compra_id INTEGER 
  REFERENCES ordens_compra(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ordens_compra_empresa ON ordens_compra(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_ordens_compra_itens_oc ON ordens_compra_itens(ordem_compra_id);
CREATE INDEX IF NOT EXISTS idx_lista_compras_ordem ON lista_compras(ordem_compra_id);
