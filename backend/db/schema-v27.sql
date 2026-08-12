-- Migration v27: colunas de cancelamento em vendas
-- Corrige bug: rota /cancelar tentava atualizar colunas que não existiam

-- Status da venda ('ativa' ou 'cancelada')
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ativa';

-- Quem cancelou (FK opcional)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

-- Quando cancelou
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMP;

-- Motivo (pode já existir)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

-- Índice pra filtro rápido
CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(empresa_id, status);
