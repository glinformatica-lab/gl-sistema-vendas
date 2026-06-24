-- Migration v21: renomeação dos planos
-- mensal → basico (R$ 99,90)
-- pro    → pro-fiscal (R$ 249,90)
-- novo:  pro (R$ 149,90 - com Vendas Online, sem NFe)
-- trial:  preservado (não mexer - sistema usa pra controle de teste)

-- 1) Remove constraints antigas
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_plano_check;
ALTER TABLE assinaturas DROP CONSTRAINT IF EXISTS assinaturas_plano_check;

-- 2) Renomeia em empresas: mensal → basico, pro → pro-fiscal
UPDATE empresas SET plano = 'basico'     WHERE plano = 'mensal';
UPDATE empresas SET plano = 'pro-fiscal' WHERE plano = 'pro';

-- 3) Renomeia em assinaturas
UPDATE assinaturas SET plano = 'basico'     WHERE plano = 'mensal';
UPDATE assinaturas SET plano = 'pro-fiscal' WHERE plano = 'pro';

-- 4) Garante valores corretos pra empresas básicas e pro-fiscal
UPDATE empresas
SET valor_mensalidade = 99.90
WHERE plano = 'basico' AND (valor_mensalidade IS NULL OR valor_mensalidade < 99.90);

UPDATE empresas
SET valor_mensalidade = 249.90
WHERE plano = 'pro-fiscal' AND (valor_mensalidade IS NULL OR valor_mensalidade < 249.90);

-- 5) Cria constraints novas (inclui 'trial' pra preservar empresas em teste)
ALTER TABLE empresas
  ADD CONSTRAINT empresas_plano_check
  CHECK (plano IN ('basico', 'pro', 'pro-fiscal', 'anual', 'empresa-extra', 'trial'));

ALTER TABLE assinaturas
  ADD CONSTRAINT assinaturas_plano_check
  CHECK (plano IN ('basico', 'pro', 'pro-fiscal', 'anual', 'empresa-extra', 'trial'));
