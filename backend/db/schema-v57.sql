-- ============================================================
-- Migration v57 - Soft delete em lab_saidas_estoque
-- ============================================================

ALTER TABLE lab_saidas_estoque
  ADD COLUMN IF NOT EXISTS estornado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estornado_por_usuario_id INTEGER REFERENCES usuarios(id);

CREATE INDEX IF NOT EXISTS idx_lab_saidas_empresa_data
  ON lab_saidas_estoque (empresa_id, data DESC);

CREATE INDEX IF NOT EXISTS idx_lab_saidas_empresa_ativo
  ON lab_saidas_estoque (empresa_id) WHERE estornado_em IS NULL;
