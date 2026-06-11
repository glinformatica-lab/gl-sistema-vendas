-- Migration v14
-- Suporte a um cliente ter acesso a múltiplas empresas
-- Abordagem espelho: cada empresa do cliente tem um usuário próprio,
-- mas todos compartilham o mesmo "grupo_id" pra serem reconhecidos como o mesmo cliente

-- Coluna grupo_id em usuarios: identifica que vários usuarios pertencem ao mesmo cliente
-- (NULL = usuário sem grupo, comportamento atual)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS grupo_id TEXT;

-- Índice pra busca rápida por grupo
CREATE INDEX IF NOT EXISTS idx_usuarios_grupo ON usuarios(grupo_id) WHERE grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(LOWER(email));

COMMENT ON COLUMN usuarios.grupo_id IS 'ID compartilhado entre cópias do mesmo usuário em empresas diferentes (multi-empresa)';
