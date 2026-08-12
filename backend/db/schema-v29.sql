-- Migration v29: Lista de Compras (Módulo Iluminação)
-- Ao aprovar orçamento, produtos sem estoque suficiente vão pra esta lista

CREATE TABLE IF NOT EXISTS lista_compras (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,

  -- Cache dos dados do produto (persiste mesmo se produto for excluído)
  produto_nome VARCHAR(200) NOT NULL,
  produto_codigo VARCHAR(50),
  referencia VARCHAR(100),

  quantidade NUMERIC(12,3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pedido', 'recebido')),

  observacao TEXT,

  -- Rastreamento
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em TIMESTAMP,
  recebido_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lista_compras_empresa ON lista_compras(empresa_id);
CREATE INDEX IF NOT EXISTS idx_lista_compras_orcamento ON lista_compras(orcamento_id);
CREATE INDEX IF NOT EXISTS idx_lista_compras_status ON lista_compras(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_lista_compras_criado_por ON lista_compras(criado_por);
