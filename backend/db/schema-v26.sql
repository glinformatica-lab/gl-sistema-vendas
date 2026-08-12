-- Migration v26: rastreamento de usuário em vendas e entradas
-- Objetivo: admin poder ver quem realizou cada operação

-- Vendas: quem criou
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_criado_por ON vendas(criado_por);

-- Entradas: quem criou
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_entradas_criado_por ON entradas(criado_por);
