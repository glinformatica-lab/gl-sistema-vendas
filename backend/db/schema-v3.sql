-- Migration v3: dados de identificação da empresa para aparecerem nos recibos
-- Idempotente: pode rodar várias vezes.

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS uf TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo TEXT; -- base64 da imagem (data:image/png;base64,...)
