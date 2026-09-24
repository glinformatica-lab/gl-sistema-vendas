-- Migration v51: Timestamp da última sync do preço Hiper
-- Serve pra mostrar no cadastro "Última sync: DD/MM/YYYY HH:MM"

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_hiper_sync_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_produtos_hiper_sync ON produtos (empresa_id, preco_hiper_sync_em DESC);
