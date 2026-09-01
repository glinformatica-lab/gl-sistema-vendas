-- Migration v43: Módulo Salão - Cadastros base
-- Cria: profissionais, servicos_salao, taxas_maquininha

CREATE TABLE IF NOT EXISTS profissionais (
  id                        SERIAL PRIMARY KEY,
  empresa_id                INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome                      TEXT NOT NULL,
  telefone                  TEXT,
  cpf                       TEXT,
  pix                       TEXT,
  data_inicio               DATE,
  percentual_espaco         NUMERIC DEFAULT 10,
  percentual_comissao_produto NUMERIC DEFAULT 0,
  observacoes               TEXT,
  ativo                     BOOLEAN DEFAULT TRUE,
  criada_em                 TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profissionais_empresa ON profissionais(empresa_id, ativo);

CREATE TABLE IF NOT EXISTS servicos_salao (
  id                  SERIAL PRIMARY KEY,
  empresa_id          INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL,
  preco_padrao        NUMERIC DEFAULT 0,
  duracao_padrao_min  INTEGER,
  produtos_receita    JSONB DEFAULT '[]'::jsonb,
  categoria           TEXT,
  ativo               BOOLEAN DEFAULT TRUE,
  criada_em           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_servicos_salao_empresa ON servicos_salao(empresa_id, ativo);

CREATE TABLE IF NOT EXISTS taxas_maquininha (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  forma_pagamento  TEXT NOT NULL,
  taxa_percentual  NUMERIC DEFAULT 0,
  UNIQUE(empresa_id, forma_pagamento)
);
CREATE INDEX IF NOT EXISTS idx_taxas_empresa ON taxas_maquininha(empresa_id);
