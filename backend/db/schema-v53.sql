-- ============================================
-- Migration v53: hiper_id_entidade em clientes/fornecedores/transportadoras
-- Chave única do Hiper como forma de match (permite cliente sem CPF/CNPJ)
-- ============================================

ALTER TABLE clientes         ADD COLUMN IF NOT EXISTS hiper_id_entidade INTEGER;
ALTER TABLE fornecedores     ADD COLUMN IF NOT EXISTS hiper_id_entidade INTEGER;
ALTER TABLE transportadoras  ADD COLUMN IF NOT EXISTS hiper_id_entidade INTEGER;

CREATE INDEX IF NOT EXISTS idx_clientes_hiper_id        ON clientes(empresa_id, hiper_id_entidade);
CREATE INDEX IF NOT EXISTS idx_fornecedores_hiper_id    ON fornecedores(empresa_id, hiper_id_entidade);
CREATE INDEX IF NOT EXISTS idx_transportadoras_hiper_id ON transportadoras(empresa_id, hiper_id_entidade);
