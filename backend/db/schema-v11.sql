-- Migration v11
-- Adiciona suporte ao Módulo Fiscal (Plano Pro) na tabela empresas
-- Não altera nada do plano atual (trial/mensal/anual) - é um complemento opcional

-- Flag principal: empresa tem o módulo fiscal (NFe/NFCe) ativo?
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_fiscal_ativo BOOLEAN NOT NULL DEFAULT FALSE;

-- Quando o módulo fiscal foi ativado (pra controle/cobrança)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_fiscal_ativado_em TIMESTAMP;

-- Valor adicional cobrado pelo módulo fiscal (default R$ 150 = diferença entre 99,90 e 249,90)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_fiscal_valor NUMERIC(14,2) DEFAULT 150.00;

-- Campos fiscais da empresa (preenchidos quando ativar o módulo - usados na Fase 2)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS regime_tributario TEXT;          -- 'mei', 'simples', 'presumido', 'real'
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cnae_principal TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS focus_nfe_token TEXT;            -- token da sub-conta na Focus NFe
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS certificado_a1_nome TEXT;        -- nome do arquivo (não o conteúdo)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS certificado_a1_validade DATE;    -- vencimento do certificado

-- Índice pra consultar empresas com módulo fiscal rapidamente
CREATE INDEX IF NOT EXISTS idx_empresas_modulo_fiscal ON empresas(modulo_fiscal_ativo);

-- Comentário de documentação
COMMENT ON COLUMN empresas.modulo_fiscal_ativo IS 'Indica se a empresa contratou o Plano Pro com emissão de NFe/NFCe';
COMMENT ON COLUMN empresas.regime_tributario IS 'Regime tributário: mei, simples, presumido, real';
