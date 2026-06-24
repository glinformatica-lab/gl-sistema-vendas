-- Migration v21: renomeação dos planos
-- mensal → basico (R$ 99,90 - sem Vendas Online, sem NFe)
-- (novo)  → pro (R$ 149,90 - com Vendas Online, sem NFe)
-- pro     → pro-fiscal (R$ 249,90 - com Vendas Online + NFe)

-- 1) Atualiza tabela empresas
UPDATE empresas
SET plano = 'basico'
WHERE plano = 'mensal';

UPDATE empresas
SET plano = 'pro-fiscal'
WHERE plano = 'pro';

-- 2) Atualiza tabela assinaturas
UPDATE assinaturas
SET plano = 'basico'
WHERE plano = 'mensal';

UPDATE assinaturas
SET plano = 'pro-fiscal'
WHERE plano = 'pro';

-- 3) Garante que empresas básicas tenham valor R$ 99,90 (caso alguma esteja errada)
UPDATE empresas
SET valor_mensalidade = 99.90
WHERE plano = 'basico' AND (valor_mensalidade IS NULL OR valor_mensalidade < 99.90);

-- 4) Garante que empresas pro-fiscal tenham R$ 249,90
UPDATE empresas
SET valor_mensalidade = 249.90
WHERE plano = 'pro-fiscal' AND valor_mensalidade < 249.90;
