-- Migration v9
-- Tabelas de Serviços e Orçamentos

-- Serviços (cadastro fixo, similar a produtos)
CREATE TABLE IF NOT EXISTS servicos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  ativo BOOLEAN DEFAULT TRUE,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_servicos_empresa ON servicos(empresa_id) WHERE ativo = TRUE;

-- Orçamentos (cabeçalho)
CREATE TABLE IF NOT EXISTS orcamentos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome TEXT,
  data_orcamento DATE NOT NULL DEFAULT CURRENT_DATE,
  validade_dias INTEGER DEFAULT 7,
  data_validade DATE,
  status TEXT NOT NULL DEFAULT 'aberto',
  -- Status: 'aberto' | 'aprovado' | 'convertido' | 'cancelado' | 'expirado'
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacoes TEXT,
  condicoes_pagamento TEXT,
  vendedor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  vendedor_nome TEXT,
  venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orcamentos_empresa ON orcamentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON orcamentos(empresa_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orcamentos_numero ON orcamentos(empresa_id, numero);

-- Itens do orçamento (produtos, serviços ou avulsos)
CREATE TABLE IF NOT EXISTS orcamento_itens (
  id SERIAL PRIMARY KEY,
  orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'produto',
  -- Tipo: 'produto' | 'servico' | 'avulso'
  produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  servico_id INTEGER REFERENCES servicos(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  quantidade NUMERIC(12,3) NOT NULL DEFAULT 1,
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto_item NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ordem INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orc_itens_orcamento ON orcamento_itens(orcamento_id);

-- Numerador automático por empresa (não compartilha)
-- Função pra próximo número
CREATE OR REPLACE FUNCTION proximo_numero_orcamento(p_empresa_id INTEGER) RETURNS INTEGER AS $$
DECLARE
  v_proximo INTEGER;
BEGIN
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_proximo
  FROM orcamentos
  WHERE empresa_id = p_empresa_id;
  RETURN v_proximo;
END;
$$ LANGUAGE plpgsql;
