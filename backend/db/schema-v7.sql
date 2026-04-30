-- Migration v7
-- Tokens para "esqueci minha senha"

CREATE TABLE IF NOT EXISTS reset_senha_tokens (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_reset_senha_token ON reset_senha_tokens(token) WHERE usado = FALSE;
CREATE INDEX IF NOT EXISTS idx_reset_senha_usuario ON reset_senha_tokens(usuario_id);
