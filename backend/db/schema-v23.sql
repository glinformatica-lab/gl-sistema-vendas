-- Migration v23: sistema de vendedores + rastreamento de indicações

-- === Tabela de vendedores ===
CREATE TABLE IF NOT EXISTS vendedores (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(200) NOT NULL,
  telefone VARCHAR(20),
  email VARCHAR(200),
  codigo VARCHAR(20) UNIQUE NOT NULL,
  senha_hash VARCHAR(200),
  chave_pix VARCHAR(200),
  tipo_pix VARCHAR(30),
  status VARCHAR(20) DEFAULT 'ativo',
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  observacoes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vendedores_codigo ON vendedores(codigo);
CREATE INDEX IF NOT EXISTS idx_vendedores_status ON vendedores(status);

-- === Coluna vendedor_id na tabela empresas ===
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS vendedor_id INTEGER REFERENCES vendedores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_empresas_vendedor ON empresas(vendedor_id);

-- === Tabela de comissões calculadas ===
CREATE TABLE IF NOT EXISTS comissoes (
  id SERIAL PRIMARY KEY,
  vendedor_id INTEGER NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  pagamento_id INTEGER,
  plano VARCHAR(50) NOT NULL,
  valor_venda NUMERIC(12,2) NOT NULL,
  percentual NUMERIC(5,2) NOT NULL,
  valor_comissao NUMERIC(12,2) NOT NULL,
  data_venda DATE NOT NULL,
  data_liberacao DATE NOT NULL,
  status VARCHAR(30) DEFAULT 'pendente',
  data_pagamento DATE,
  observacoes TEXT,
  criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comissoes_vendedor ON comissoes(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_empresa ON comissoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_status ON comissoes(status);
CREATE INDEX IF NOT EXISTS idx_comissoes_data_liberacao ON comissoes(data_liberacao);
