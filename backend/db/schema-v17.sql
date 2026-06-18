-- Migration v17: adicionar coluna foto_url em produtos
-- Pra suportar fotos hospedadas no Cloudinary

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS foto_url TEXT;

COMMENT ON COLUMN produtos.foto_url IS 'URL pública da foto no Cloudinary (formato https://res.cloudinary.com/...)';
