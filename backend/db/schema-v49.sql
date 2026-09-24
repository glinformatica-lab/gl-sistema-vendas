-- Migration v49: Preço dual (FISCAL / NÃO FISCAL)
-- Exclusivo do Módulo INTEGRA HIPER
-- Permite que cada produto tenha 2 preços de venda:
--   preco_venda           → preço FISCAL (nota fiscal)
--   preco_venda_nao_fiscal → preço NÃO FISCAL (venda sem nota)

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_venda_nao_fiscal NUMERIC(14,2);

-- Vendas: guardar qual tipo foi usado (pra relatório e auditoria)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS tipo_nota VARCHAR(15) DEFAULT 'fiscal';
-- 'fiscal' = com nota (usa preco_venda)
-- 'nao_fiscal' = sem nota (usa preco_venda_nao_fiscal)

-- Orçamentos: mesma coisa
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS tipo_nota VARCHAR(15) DEFAULT 'fiscal';

-- Índice pra relatórios de faturamento fiscal vs não fiscal
CREATE INDEX IF NOT EXISTS idx_vendas_tipo_nota ON vendas (empresa_id, tipo_nota, data DESC);
