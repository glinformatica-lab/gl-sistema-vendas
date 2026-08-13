-- Migration v36: Tabela de Marcas (fabricantes)
-- Diferente de fornecedor: quem FABRICA o produto (Osram, Philips, Golden, Startec...)
-- Fornecedor é quem VENDE pra você (distribuidor)
-- Uma marca pode ter vários fornecedores; um fornecedor pode vender várias marcas

CREATE TABLE IF NOT EXISTS marcas (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome VARCHAR(120) NOT NULL,
  observacao TEXT,
  criado_em TIMESTAMP DEFAULT NOW(),
  UNIQUE(empresa_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_marcas_empresa ON marcas(empresa_id);

-- Adiciona relação em produtos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS marca_id INTEGER REFERENCES marcas(id) ON DELETE SET NULL;
-- Cache do nome pra evitar JOIN em queries simples e sobreviver se marca for excluída
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS marca VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_produtos_marca ON produtos(empresa_id, marca_id) WHERE marca_id IS NOT NULL;
