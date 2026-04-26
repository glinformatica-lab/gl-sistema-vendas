-- Migration v2: SaaS Master + controle de licença
-- Idempotente: pode rodar várias vezes sem quebrar.

-- 1. Ampliar tabela "empresas" com campos de licença
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'trial';
  -- valores possíveis: 'trial' | 'ativa' | 'vencida' | 'bloqueada'
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'trial';
  -- valores possíveis: 'trial' | 'mensal' | 'anual'
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS data_vencimento DATE;
  -- data até a qual o cliente pode usar o sistema
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS valor_mensalidade NUMERIC(14,2) DEFAULT 0;
  -- valor cobrado por mês (referência para receita)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS observacao TEXT;
  -- anotações livres do master sobre a empresa

-- 2. Tabela de usuários Master (separada de "usuarios" - sem empresa_id)
CREATE TABLE IF NOT EXISTS master_usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  ultimo_login TIMESTAMPTZ
);

-- 3. Histórico de pagamentos / renovações
CREATE TABLE IF NOT EXISTS pagamentos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  valor NUMERIC(14,2) NOT NULL,
  data_pagamento DATE NOT NULL,
  plano_aplicado TEXT, -- 'mensal' | 'anual'
  meses_adicionados INTEGER DEFAULT 1,
  novo_vencimento DATE,
  forma_pagamento TEXT, -- 'PIX' | 'Boleto' | 'Cartão' | 'Transferência' | 'Outro'
  observacao TEXT,
  registrado_por INTEGER, -- master_usuarios.id que registrou
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagamentos_empresa ON pagamentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_data ON pagamentos(data_pagamento);
