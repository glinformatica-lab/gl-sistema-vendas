-- Migration v31: Rastreamento de cancelamento de orçamentos
-- Similar ao que já existe em vendas (v27)

ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cancelado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cancelado_por_nome VARCHAR(120);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS autorizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS autorizado_por_nome VARCHAR(120);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMP;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;
