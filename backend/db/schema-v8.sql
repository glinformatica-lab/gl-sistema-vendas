-- Migration v8 (corrigida — nome real da tabela é master_usuarios)
-- Auditoria de acessos de suporte do Master nas empresas

CREATE TABLE IF NOT EXISTS master_acessos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  master_id INTEGER REFERENCES master_usuarios(id) ON DELETE SET NULL,
  master_email TEXT,
  motivo TEXT,
  ip TEXT,
  user_agent TEXT,
  acessado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_acessos_empresa ON master_acessos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_master_acessos_data ON master_acessos(acessado_em DESC);
