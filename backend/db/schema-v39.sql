-- Migration v39: Créditos de devolução por cliente (módulo iluminação)

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS credito_saldo NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS creditos_cliente (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada', 'uso', 'ajuste')),
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  origem_venda_id INTEGER,
  destino_venda_id INTEGER,
  motivo TEXT,
  saldo_apos NUMERIC(12,2) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  criado_por INTEGER,
  criado_por_nome VARCHAR(150)
);

CREATE INDEX IF NOT EXISTS idx_creditos_cliente_cliente ON creditos_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_creditos_cliente_empresa ON creditos_cliente(empresa_id);
CREATE INDEX IF NOT EXISTS idx_creditos_cliente_origem ON creditos_cliente(origem_venda_id);
