-- Migration v28: referência e código de barras para produtos
-- Apenas usado por empresas com Módulo Iluminação ativo (usa_ambientes = true)

-- Referência do fabricante (livre, único por empresa)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS referencia VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_referencia_empresa
  ON produtos(empresa_id, referencia)
  WHERE referencia IS NOT NULL AND referencia != '';

-- Código de barras auto-gerado (sequencial: PRD-000042)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(empresa_id, codigo_barras);

-- Popula código de barras nos produtos existentes (só empresas com módulo iluminação)
UPDATE produtos p
SET codigo_barras = 'PRD-' || LPAD(p.id::TEXT, 6, '0')
WHERE codigo_barras IS NULL
  AND EXISTS (SELECT 1 FROM empresas e WHERE e.id = p.empresa_id AND e.usa_ambientes = true);
