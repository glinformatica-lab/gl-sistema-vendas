-- Migration v47: Suporte a moeda estrangeira (Euro, Dólar) em produtos e entradas
-- Guarda rastreabilidade completa: valor origem + cotação + valor em Real

-- Coluna nova em PRODUTOS
-- Quando NULL, o produto é em Real normal (não interfere no comportamento atual)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS moeda_origem VARCHAR(3);       -- 'EUR', 'USD', 'GBP' ou NULL
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_custo_origem NUMERIC(14,4);  -- valor na moeda origem
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cotacao_usada NUMERIC(10,4);   -- cotação usada na última entrada
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cotacao_data DATE;             -- data da cotação usada

-- Colunas em ENTRADAS (nota inteira em moeda estrangeira)
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS moeda_origem VARCHAR(3);
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS cotacao NUMERIC(10,4);         -- cotação usada nesta nota
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS cotacao_data DATE;
ALTER TABLE entradas ADD COLUMN IF NOT EXISTS total_origem NUMERIC(14,4);    -- total da nota na moeda origem

-- Cache de cotações (evita bater na API BC toda hora)
CREATE TABLE IF NOT EXISTS cotacoes_cache (
  id          SERIAL PRIMARY KEY,
  moeda       VARCHAR(3) NOT NULL,
  data        DATE NOT NULL,
  cotacao     NUMERIC(10,4) NOT NULL,
  fonte       VARCHAR(50),                 -- 'awesomeapi', 'bcb', 'manual'
  buscada_em  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (moeda, data)
);
CREATE INDEX IF NOT EXISTS idx_cotacoes_moeda_data ON cotacoes_cache (moeda, data DESC);
