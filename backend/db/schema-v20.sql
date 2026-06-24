-- Migration v20: pedidos online (catálogo público com pedido por WhatsApp)

CREATE TABLE IF NOT EXISTS pedidos_online (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Identificação amigável (PED-2026-0001)
  numero TEXT NOT NULL,
  -- Dados do cliente final (quem comprou no catálogo)
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  cliente_email TEXT,
  cliente_documento TEXT,
  -- Endereço de entrega (opcional)
  endereco TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  complemento TEXT,
  -- Totais
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Status do pedido
  status TEXT NOT NULL DEFAULT 'novo',
    -- novo | em-atendimento | confirmado | cancelado | convertido-em-venda
  -- Observações do cliente final (mensagem livre)
  observacoes TEXT,
  -- Quando virou venda, guarda referência (pra rastrear)
  venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_empresa ON pedidos_online(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_online_status ON pedidos_online(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_pedidos_online_data ON pedidos_online(empresa_id, criado_em DESC);

-- Itens do pedido (1 linha por produto solicitado)
CREATE TABLE IF NOT EXISTS pedidos_online_itens (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos_online(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  -- Snapshot dos dados do produto NO MOMENTO do pedido (pra preservar histórico)
  produto_nome TEXT NOT NULL,
  produto_codigo TEXT,
  quantidade NUMERIC(14,3) NOT NULL,
  preco_unitario NUMERIC(14,2),
  subtotal NUMERIC(14,2)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_online_itens_pedido ON pedidos_online_itens(pedido_id);

COMMENT ON TABLE pedidos_online IS 'Pedidos gerados pelo catálogo público (cliente final)';
COMMENT ON COLUMN pedidos_online.status IS 'novo | em-atendimento | confirmado | cancelado | convertido-em-venda';
