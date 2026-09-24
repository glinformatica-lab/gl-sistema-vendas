-- Migration v48: Módulo INTEGRA HIPER
-- Sincronização com sistema fiscal Hiper (API nuvem + SQL local via agent)

-- Ativar módulo por empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_integra_hiper BOOLEAN DEFAULT FALSE;

-- Configuração Hiper (por empresa)
CREATE TABLE IF NOT EXISTS hiper_config (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  chave_api             TEXT,               -- chave da API nuvem Hiper (64 chars)
  token_agent           TEXT,               -- token único do agent local (gerado aleatório)
  intervalo_sync_min    INTEGER DEFAULT 15, -- 5/15/30/60
  ativo                 BOOLEAN DEFAULT TRUE,
  ultima_sync_produtos  TIMESTAMPTZ,
  ultima_sync_estoque   TIMESTAMPTZ,
  ultima_sync_clientes  TIMESTAMPTZ,
  ultima_sync_fornec    TIMESTAMPTZ,
  ponto_sync_produtos   BIGINT DEFAULT 0,   -- pontoDeSincronizacao Hiper (incremental)
  ponto_sync_estoque    BIGINT DEFAULT 0,
  criado_em             TIMESTAMPTZ DEFAULT NOW()
);

-- Log de sincronização (auditoria)
CREATE TABLE IF NOT EXISTS hiper_log_sync (
  id             SERIAL PRIMARY KEY,
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo           VARCHAR(30) NOT NULL, -- 'produtos'|'estoque'|'clientes'|'fornecedores'
  fonte          VARCHAR(20) NOT NULL, -- 'api_hiper'|'sql_local'
  status         VARCHAR(15) NOT NULL, -- 'ok'|'erro'|'parcial'
  qtd_criados    INTEGER DEFAULT 0,
  qtd_atualizados INTEGER DEFAULT 0,
  qtd_erros      INTEGER DEFAULT 0,
  duracao_ms     INTEGER,
  mensagem       TEXT,
  executado_em   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hiper_log_empresa_data
  ON hiper_log_sync(empresa_id, executado_em DESC);

-- Mapeamento Hiper ID → GL ID (evita duplicar e permite update)
CREATE TABLE IF NOT EXISTS hiper_map_produtos (
  id            SERIAL PRIMARY KEY,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  hiper_id      VARCHAR(36) NOT NULL, -- UUID do produto no Hiper
  produto_id    INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  hiper_codigo  VARCHAR(50),
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, hiper_id)
);
CREATE INDEX IF NOT EXISTS idx_hiper_map_prod_empresa
  ON hiper_map_produtos(empresa_id);
