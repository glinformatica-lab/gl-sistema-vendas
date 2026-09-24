-- ============================================
-- Migration v54: Sync bidirecional Local <-> Nuvem
-- Adiciona sync_uuid + updated_at + triggers nas tabelas sincronizadas
-- ============================================

-- Extensão de UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Função genérica pra atualizar updated_at em qualquer UPDATE
CREATE OR REPLACE FUNCTION _sync_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Adiciona sync_uuid + updated_at + trigger em cada tabela sincronizada
DO $$
DECLARE
  t TEXT;
  tabs TEXT[] := ARRAY[
    'produtos', 'clientes', 'fornecedores', 'transportadoras',
    'vendas', 'venda_itens', 'movimentacoes',
    'orcamentos', 'orcamento_itens',
    'contas_pagar', 'contas_receber',
    'entradas', 'entrada_itens',
    'servicos', 'marcas'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    -- Só aplica se a tabela existir
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      -- sync_uuid (chave lógica única entre local e nuvem)
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sync_uuid UUID DEFAULT gen_random_uuid()', t);
      -- updated_at
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()', t);
      -- Backfill sync_uuid para registros existentes sem uuid
      EXECUTE format('UPDATE %I SET sync_uuid = gen_random_uuid() WHERE sync_uuid IS NULL', t);
      -- Backfill updated_at (deixa NOW se ainda estiver null)
      EXECUTE format('UPDATE %I SET updated_at = NOW() WHERE updated_at IS NULL', t);
      -- Index em sync_uuid
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_sync_uuid ON %I(sync_uuid)', t, t);
      -- Trigger que atualiza updated_at automaticamente
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
      EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION _sync_touch_updated_at()', t, t);
      RAISE NOTICE 'Tabela % preparada pra sync', t;
    END IF;
  END LOOP;
END $$;

-- Índice em updated_at + empresa_id só nas tabelas que TEM empresa_id
DO $$
DECLARE
  t TEXT;
  tabs TEXT[] := ARRAY[
    'produtos', 'clientes', 'fornecedores', 'transportadoras',
    'vendas', 'venda_itens', 'movimentacoes',
    'orcamentos', 'orcamento_itens',
    'contas_pagar', 'contas_receber',
    'entradas', 'entrada_itens',
    'servicos', 'marcas'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'empresa_id') THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_upd_emp ON %I(empresa_id, updated_at)', t, t);
    END IF;
  END LOOP;
END $$;

-- Tabela de estado de sync (por empresa/tabela)
CREATE TABLE IF NOT EXISTS sync_state (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tabela VARCHAR(50) NOT NULL,
  ultimo_sync_up TIMESTAMPTZ DEFAULT '1970-01-01',
  ultimo_sync_down TIMESTAMPTZ DEFAULT '1970-01-01',
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa_id, tabela)
);

-- Log de sync pra debug e monitoramento
CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER,
  direcao VARCHAR(10) NOT NULL,
  tabela VARCHAR(50) NOT NULL,
  registros INTEGER DEFAULT 0,
  duracao_ms INTEGER,
  status VARCHAR(20) DEFAULT 'ok',
  erro TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_empresa ON sync_log(empresa_id, criado_em DESC);

-- Token de sync (pra autenticar Local -> Nuvem)
CREATE TABLE IF NOT EXISTS sync_tokens (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  token VARCHAR(128) NOT NULL UNIQUE,
  descricao TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  ultimo_uso TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_tokens_token ON sync_tokens(token);
