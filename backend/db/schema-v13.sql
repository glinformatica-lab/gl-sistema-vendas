-- Migration v13
-- Adiciona campos para registrar cancelamento de venda (com motivo e auditoria)
-- A venda NÃO é apagada - vira status 'cancelada' e mantém o histórico

-- Status da venda: 'ativa' (padrão) ou 'cancelada'
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativa';

-- Quem cancelou e quando
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMP;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelada_por_id INTEGER REFERENCES usuarios(id);
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cancelada_por_nome TEXT;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

-- Índice pra filtrar vendas ativas rapidamente
CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(empresa_id, status);

COMMENT ON COLUMN vendas.status IS 'ativa = válida (entra no faturamento); cancelada = não conta em relatórios';
COMMENT ON COLUMN vendas.motivo_cancelamento IS 'Motivo informado pelo admin no momento do cancelamento';
