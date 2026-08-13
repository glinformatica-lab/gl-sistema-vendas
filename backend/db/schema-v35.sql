-- Migration v35: Rascunhos automáticos
-- Salva formulários em progresso pra não perder por rede/PC/crash

CREATE TABLE IF NOT EXISTS rascunhos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo_form VARCHAR(50) NOT NULL, -- orcamento, venda, entrada, etc.
  chave VARCHAR(100),              -- opcional: identifica múltiplos rascunhos por tipo (ex: id de edição)
  conteudo JSONB NOT NULL,
  atualizado_em TIMESTAMP DEFAULT NOW(),
  criado_em TIMESTAMP DEFAULT NOW(),
  UNIQUE(empresa_id, usuario_id, tipo_form, chave)
);

CREATE INDEX IF NOT EXISTS idx_rascunhos_lookup ON rascunhos(empresa_id, usuario_id, tipo_form);
CREATE INDEX IF NOT EXISTS idx_rascunhos_atualizado ON rascunhos(atualizado_em);
