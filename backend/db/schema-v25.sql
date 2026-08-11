-- Migration v25: campos extras de descrição em produtos
-- Uso: empresas com ambientes ativos (iluminação, marcenaria, etc)

-- Descrição pública para impressão (aparece no orçamento pro cliente)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao_impressao TEXT;

-- Observação interna (só vendedor vê - NUNCA aparece na impressão)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS observacao_interna TEXT;
