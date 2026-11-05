-- ============================================================
-- Migration v58 - Adiciona departamento em usuarios
-- ============================================================
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS departamento TEXT;

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_depto
  ON usuarios (empresa_id, departamento);
