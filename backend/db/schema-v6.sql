-- Migration v6
-- Fechamento de caixa diário

CREATE TABLE IF NOT EXISTS caixas (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  saldo_inicial NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aberto', -- 'aberto' | 'fechado'
  saldo_final_informado NUMERIC(14, 2), -- quanto o vendedor contou no fim
  obs TEXT,
  aberto_por INTEGER REFERENCES usuarios(id),
  aberto_em TIMESTAMPTZ DEFAULT NOW(),
  fechado_por INTEGER REFERENCES usuarios(id),
  fechado_em TIMESTAMPTZ,
  UNIQUE (empresa_id, data) -- 1 caixa por dia por empresa
);

CREATE INDEX IF NOT EXISTS idx_caixas_empresa_data ON caixas(empresa_id, data DESC);

CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  caixa_id INTEGER NOT NULL REFERENCES caixas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- 'reforco' | 'sangria' | 'despesa'
  valor NUMERIC(14, 2) NOT NULL,
  descricao TEXT NOT NULL,
  categoria TEXT, -- pra despesas: 'alimentacao' | 'combustivel' | 'manutencao' | 'outros'
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caixa_movimentos_caixa ON caixa_movimentos(caixa_id);
