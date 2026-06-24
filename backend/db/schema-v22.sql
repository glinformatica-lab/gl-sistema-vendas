-- Migration v22: adicionar planos anuais (basico-anual, pro-anual, pro-fiscal-anual)
-- Valores: 10% de desconto sobre 12 mensalidades
-- basico-anual:     R$ 1.078,92 (R$ 99,90  × 12 × 0.9)
-- pro-anual:        R$ 1.618,92 (R$ 149,90 × 12 × 0.9)
-- pro-fiscal-anual: R$ 2.698,92 (R$ 249,90 × 12 × 0.9) - em dev

-- Atualiza constraints pra aceitar os novos planos
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_plano_check;
ALTER TABLE assinaturas DROP CONSTRAINT IF EXISTS assinaturas_plano_check;

ALTER TABLE empresas
  ADD CONSTRAINT empresas_plano_check
  CHECK (plano IN ('basico', 'pro', 'pro-fiscal', 'anual', 'basico-anual', 'pro-anual', 'pro-fiscal-anual', 'empresa-extra', 'trial'));

ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_plano_check
  CHECK (plano IN ('basico', 'pro', 'pro-fiscal', 'anual', 'basico-anual', 'pro-anual', 'pro-fiscal-anual', 'empresa-extra', 'trial'));
