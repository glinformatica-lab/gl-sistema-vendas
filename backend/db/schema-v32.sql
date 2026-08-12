-- Migration v32: Fluxo Financeiro + Estoque (Módulo Iluminação)
-- Novos status de orçamento: aguardando_financeiro, aprovado_financeiro,
--                             rejeitado_financeiro, em_separacao, separado
-- Campos de rastreamento: financeiro (aprova/rejeita) + separação por item

-- Colunas de aprovação financeira no orçamento
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_aprovado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_aprovado_por_nome VARCHAR(120);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_aprovado_em TIMESTAMP;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_rejeitado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_rejeitado_por_nome VARCHAR(120);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_rejeitado_em TIMESTAMP;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS motivo_rejeicao_financeira TEXT;

-- Colunas de separação (estoque)
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS separacao_iniciada_em TIMESTAMP;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS separado_em TIMESTAMP;

-- Coluna de status na tabela de itens do orçamento (separação item por item)
ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS status_separacao VARCHAR(20) DEFAULT 'pendente' 
  CHECK (status_separacao IN ('pendente', 'separado', 'aguardando_compra'));
ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS separado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS separado_por_nome VARCHAR(120);
ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS separado_em TIMESTAMP;

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_orcamentos_status_empresa ON orcamentos(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_orcamento_itens_separacao ON orcamento_itens(orcamento_id, status_separacao);
