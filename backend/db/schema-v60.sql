-- ============================================================
-- Migration v60 - Adiciona 'laboratorio' ao CHECK de assinaturas.plano
-- ============================================================
ALTER TABLE assinaturas DROP CONSTRAINT IF EXISTS assinaturas_plano_check;
ALTER TABLE assinaturas ADD CONSTRAINT assinaturas_plano_check CHECK (
  plano IN (
    'basico', 'pro', 'pro-fiscal', 'salao', 'laboratorio',
    'basico-anual', 'pro-anual', 'pro-fiscal-anual',
    'anual', 'mensal', 'trial'
  )
);
