-- Migration v50: Ajuste conceitual do módulo INTEGRA HIPER
-- Renomeia preco_venda_nao_fiscal → preco_hiper
-- Motivo: no fluxo real, TODA venda no GL é sem nota (usa preco_venda normal).
-- O "preço do Hiper" é apenas INFORMATIVO — mostra o valor praticado no
-- sistema fiscal, pra dona comparar/decidir se ajusta o preço no GL.

DO $$
BEGIN
  -- Só renomeia se a coluna antiga existe E a nova não existe
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'produtos' AND column_name = 'preco_venda_nao_fiscal'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'produtos' AND column_name = 'preco_hiper'
  ) THEN
    ALTER TABLE produtos RENAME COLUMN preco_venda_nao_fiscal TO preco_hiper;
  END IF;

  -- Se por acaso já existe preco_hiper (rodou a migration antes), não faz nada
END $$;

-- Remove coluna tipo_nota das vendas — não vai mais ser usada
-- (a v49 criou, mas mudou o fluxo. Deixamos o DROP condicional pra não quebrar.)
ALTER TABLE vendas DROP COLUMN IF EXISTS tipo_nota;
ALTER TABLE orcamentos DROP COLUMN IF EXISTS tipo_nota;
DROP INDEX IF EXISTS idx_vendas_tipo_nota;
