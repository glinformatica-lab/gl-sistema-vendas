-- Migration v15
-- Suporta novos planos na tabela assinaturas: 'pro', 'empresa-extra'
-- Adiciona coluna metadata pra guardar dados extras (nome da nova empresa, etc)

-- 1) Remove CHECK constraint antiga (só permitia mensal/anual)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'assinaturas'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%plano%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE assinaturas DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

-- 2) Adiciona NOVA CHECK constraint mais permissiva
ALTER TABLE assinaturas ADD CONSTRAINT assinaturas_plano_check
  CHECK (plano IN ('mensal', 'anual', 'pro', 'empresa-extra'));

-- 3) Adiciona coluna metadata pra guardar dados extras
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN assinaturas.metadata IS 'Dados extras: nomeNovaEmpresa, cnpjNovaEmpresa (pra plano empresa-extra)';
