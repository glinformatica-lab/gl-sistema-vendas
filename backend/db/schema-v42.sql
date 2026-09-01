-- Migration v42: Módulo Salão - Feature toggle
-- Adiciona coluna modulo_salao em empresas

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_salao BOOLEAN DEFAULT FALSE;
