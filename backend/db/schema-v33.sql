-- Migration v33: Venda em separação (Módulo Iluminação)
-- Aprovação financeira já cria venda, mas com status 'em_separacao'
-- Estoque só é baixado quando Separação for concluída

-- Novo valor de status: 'em_separacao'
-- vendas.status existente permite qualquer texto (não tem CHECK), OK
-- Mas para segurança tipa como VARCHAR

-- Adiciona vínculo direto orçamento ↔ venda (já existe orcamentos.venda_id, agora criamos o inverso)
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_orcamento ON vendas(orcamento_id);
CREATE INDEX IF NOT EXISTS idx_vendas_status_empresa ON vendas(empresa_id, status);
