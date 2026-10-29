-- ============================================
-- Migration v56: Modulo Laboratorio
-- Cliente: laboratorio de consultas e exames medicos
-- ============================================

-- 1) Flag na empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_laboratorio BOOLEAN DEFAULT FALSE;

-- 2) Produtos: validade + estoque minimo (usado pelo lab, mas disponivel pra qualquer empresa)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS validade DATE;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(14,3) DEFAULT 0;

-- 3) Catalogo de servicos do laboratorio (consulta, exame X, Y...)
CREATE TABLE IF NOT EXISTS lab_servicos (
  id         SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo     VARCHAR(30),
  nome       VARCHAR(200) NOT NULL,
  descricao  TEXT,
  preco      NUMERIC(10,2) NOT NULL DEFAULT 0,
  ativo      BOOLEAN DEFAULT TRUE,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_servicos_empresa_ativo
  ON lab_servicos(empresa_id, ativo);

-- 4) Atendimentos (caixa particular) - cabecalho
CREATE TABLE IF NOT EXISTS lab_atendimentos (
  id                   SERIAL PRIMARY KEY,
  empresa_id           INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  data                 DATE NOT NULL DEFAULT CURRENT_DATE,
  paciente_nome        VARCHAR(200),
  paciente_doc         VARCHAR(30),
  paciente_tel         VARCHAR(30),
  valor_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  forma_pagamento      VARCHAR(30),
  obs                  TEXT,
  usuario_atendente_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_atendimentos_empresa_data
  ON lab_atendimentos(empresa_id, data DESC);

-- 5) Itens de cada atendimento
CREATE TABLE IF NOT EXISTS lab_atendimento_itens (
  id             SERIAL PRIMARY KEY,
  atendimento_id INTEGER NOT NULL REFERENCES lab_atendimentos(id) ON DELETE CASCADE,
  servico_id     INTEGER REFERENCES lab_servicos(id) ON DELETE SET NULL,
  servico_nome   VARCHAR(200) NOT NULL,
  valor          NUMERIC(10,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_atendimento_itens_atendimento
  ON lab_atendimento_itens(atendimento_id);

-- 6) Saidas manuais de estoque (rastreamento: quem entregou -> quem recebeu)
CREATE TABLE IF NOT EXISTS lab_saidas_estoque (
  id           SERIAL PRIMARY KEY,
  empresa_id   INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  data         DATE NOT NULL DEFAULT CURRENT_DATE,
  produto_id   INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  produto_nome VARCHAR(200),
  qtd          NUMERIC(14,3) NOT NULL,
  entregue_por VARCHAR(100),
  recebido_por VARCHAR(100),
  obs          TEXT,
  usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_saidas_empresa_data
  ON lab_saidas_estoque(empresa_id, data DESC);
