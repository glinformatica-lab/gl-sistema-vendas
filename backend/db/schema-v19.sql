-- Migration v19: catálogo público compartilhável (com curadoria por produto)

-- 1) Slug em empresas (pra URL bonita: /catalogo/gl-informatica)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS catalogo_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_catalogo_slug
  ON empresas(catalogo_slug) WHERE catalogo_slug IS NOT NULL;

-- 2) Configurações globais do catálogo (1 por empresa)
CREATE TABLE IF NOT EXISTS catalogo_config (
  empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT FALSE,
  mensagem_topo TEXT,
  whatsapp TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- 3) Itens curados do catálogo (1 linha por produto que aparece)
CREATE TABLE IF NOT EXISTS catalogo_itens (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 0,
  mostrar_preco BOOLEAN NOT NULL DEFAULT TRUE,
  mostrar_estoque BOOLEAN NOT NULL DEFAULT FALSE,
  descricao_custom TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, produto_id)
);

CREATE INDEX IF NOT EXISTS idx_catalogo_itens_empresa ON catalogo_itens(empresa_id);
CREATE INDEX IF NOT EXISTS idx_catalogo_itens_ordem ON catalogo_itens(empresa_id, ordem);

COMMENT ON TABLE catalogo_config IS 'Configurações gerais do catálogo público';
COMMENT ON TABLE catalogo_itens IS 'Produtos curados que aparecem no catálogo público';
