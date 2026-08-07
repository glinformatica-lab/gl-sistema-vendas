-- Migration v24: sistema de AMBIENTES em orçamentos (uso: iluminação, marcenaria, etc)

-- 1. Feature flag: empresa usa ambientes?
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS usa_ambientes BOOLEAN DEFAULT false;

-- 2. Tabela de ambientes cadastrados pela empresa
CREATE TABLE IF NOT EXISTS ambientes (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome VARCHAR(100) NOT NULL,
  ordem INTEGER DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (empresa_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_ambientes_empresa ON ambientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_ambientes_ativo ON ambientes(empresa_id, ativo);

-- 3. Coluna ambiente_id nos itens do orçamento (NULL = sem ambiente / geral)
ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS ambiente_id INTEGER REFERENCES ambientes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orc_itens_ambiente ON orcamento_itens(ambiente_id);
