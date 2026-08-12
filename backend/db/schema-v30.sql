-- Migration v30: Transportadoras (Módulo Iluminação)

CREATE TABLE IF NOT EXISTS transportadoras (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome VARCHAR(200) NOT NULL,
  cnpj VARCHAR(20),
  telefone VARCHAR(30),
  email VARCHAR(120),
  endereco VARCHAR(255),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  uf VARCHAR(2),
  cep VARCHAR(10),
  contato VARCHAR(100),
  observacao TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transportadoras_empresa ON transportadoras(empresa_id);
CREATE INDEX IF NOT EXISTS idx_transportadoras_nome ON transportadoras(empresa_id, nome);

-- Adiciona coluna em orcamentos
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS transportadora_id INTEGER REFERENCES transportadoras(id) ON DELETE SET NULL;

-- Adiciona coluna em vendas
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS transportadora_id INTEGER REFERENCES transportadoras(id) ON DELETE SET NULL;
