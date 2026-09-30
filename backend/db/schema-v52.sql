-- ============================================
-- Migration v52: estoque hiper + inscricao_estadual em transportadoras
-- INTEGRA HIPER Fase 3
-- OBS: tabela transportadoras JÁ EXISTE. Só adicionamos IE + índice por CNPJ.
-- ============================================

-- 1) Inscrição estadual em transportadoras (não existia)
ALTER TABLE transportadoras ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(30);

-- 2) Índice pra buscar transportadora por CNPJ (usado pelo agent do Hiper)
CREATE INDEX IF NOT EXISTS idx_transportadoras_cnpj ON transportadoras(empresa_id, cnpj);

-- 3) Estoque Hiper (informativo, não sobrescreve estoque do GL)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_hiper NUMERIC(14,3) DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_hiper_sync_em TIMESTAMPTZ;
