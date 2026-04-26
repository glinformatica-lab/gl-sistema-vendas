-- Migration v5
-- Adiciona origem (auto-assinatura | manual) nas empresas
-- A coluna valor_mensalidade já existe desde a v2
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'manual';

-- Empresas existentes sem origem definida ficam como 'manual'
UPDATE empresas SET origem = 'manual' WHERE origem IS NULL;

-- Empresas que vieram do /assinar (têm assinaturas vinculadas) marcadas como auto-assinatura
UPDATE empresas SET origem = 'auto-assinatura'
WHERE id IN (SELECT DISTINCT empresa_id FROM assinaturas WHERE empresa_id IS NOT NULL);
