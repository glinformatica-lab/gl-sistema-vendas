-- Migration v46: Módulo Salão - Vales + Fechamento Mensal

CREATE TABLE IF NOT EXISTS vales_profissional (
  id                SERIAL PRIMARY KEY,
  empresa_id        INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id   INTEGER NOT NULL REFERENCES profissionais(id),
  data              DATE NOT NULL DEFAULT CURRENT_DATE,
  valor             NUMERIC(12,2) NOT NULL,
  observacao        TEXT,
  -- Ao fechar o mês, este vale fica "trancado" e recebe o id do fechamento.
  -- Enquanto fechamento_id IS NULL, o vale pode ser editado/apagado.
  fechamento_id     INTEGER,
  criado_em         TIMESTAMPTZ DEFAULT NOW(),
  criado_por        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vales_empresa_data ON vales_profissional(empresa_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_vales_prof_data ON vales_profissional(profissional_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_vales_fechamento ON vales_profissional(fechamento_id);

CREATE TABLE IF NOT EXISTS fechamentos_mensais (
  id                        SERIAL PRIMARY KEY,
  empresa_id                INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id           INTEGER NOT NULL REFERENCES profissionais(id),
  mes                       INTEGER NOT NULL,   -- 1..12
  ano                       INTEGER NOT NULL,

  -- Snapshot dos valores no momento do fechamento
  qtd_atendimentos          INTEGER NOT NULL DEFAULT 0,
  total_servicos            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_comissao_produtos   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_taxa_espaco         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- 10% dos serviços
  total_vales               NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_liquido             NUMERIC(12,2) NOT NULL DEFAULT 0,   -- serviços - taxa espaço + comissão produtos - vales

  status                    TEXT NOT NULL DEFAULT 'fechado',    -- 'fechado' | 'pago'
  fechado_em                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fechado_por               INTEGER,

  pago_em                   DATE,
  forma_pagamento           TEXT,
  observacoes               TEXT,

  UNIQUE(empresa_id, profissional_id, mes, ano)
);
CREATE INDEX IF NOT EXISTS idx_fechamentos_empresa ON fechamentos_mensais(empresa_id, ano, mes);
CREATE INDEX IF NOT EXISTS idx_fechamentos_prof ON fechamentos_mensais(profissional_id, ano, mes);
