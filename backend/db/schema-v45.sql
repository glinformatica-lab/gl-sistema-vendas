-- Migration v45: Módulo Salão - Atendimentos (o coração do sistema)

CREATE TABLE IF NOT EXISTS atendimentos (
  id                        SERIAL PRIMARY KEY,
  empresa_id                INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  agendamento_id            INTEGER REFERENCES agendamentos(id) ON DELETE SET NULL,
  profissional_id           INTEGER NOT NULL REFERENCES profissionais(id),

  -- Cliente (cadastrado ou avulso, igual agendamento)
  cliente_id                INTEGER REFERENCES clientes(id),
  cliente_nome              TEXT NOT NULL,
  cliente_telefone          TEXT,

  -- Data e hora
  data                      DATE NOT NULL DEFAULT CURRENT_DATE,
  hora                      TIME DEFAULT CURRENT_TIME,

  -- Serviços prestados (JSONB): [{servicoId, nome, preco}]
  servicos                  JSONB NOT NULL DEFAULT '[]',
  subtotal_servicos         NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Produtos VENDIDOS (JSONB): [{produtoId, nome, qtd, precoUnit, subtotal, comissaoPct, comissaoValor}]
  produtos_vendidos         JSONB NOT NULL DEFAULT '[]',
  subtotal_produtos         NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Produtos USADOS no atendimento (não vão pro faturamento; só custo/estoque)
  -- JSONB: [{produtoId, nome, qtd, custoUnit, custoTotal, baixarEstoque}]
  produtos_usados           JSONB NOT NULL DEFAULT '[]',
  custo_produtos_usados     NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Totais
  desconto                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_bruto               NUMERIC(12,2) NOT NULL DEFAULT 0,   -- serviços + produtos vendidos - desconto

  -- Pagamento (JSONB pra suportar múltiplas formas)
  -- [{formaPagamento, valor, taxaPct, taxaValor, valorLiquido}]
  pagamentos                JSONB NOT NULL DEFAULT '[]',
  total_taxas_maquininha    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_liquido             NUMERIC(12,2) NOT NULL DEFAULT 0,   -- total_bruto - total_taxas

  -- Divisão de valores
  valor_espaco_salao        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- % espaço × subtotal_servicos
  valor_comissao_profissional NUMERIC(12,2) NOT NULL DEFAULT 0, -- soma de comissões de produtos vendidos
  valor_liquido_profissional NUMERIC(12,2) NOT NULL DEFAULT 0,  -- serviços - espaço + comissão produtos
  valor_liquido_salao       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- espaço + produtos - comissão prof - taxas

  observacoes               TEXT,
  cancelado                 BOOLEAN DEFAULT FALSE,
  cancelado_em              TIMESTAMPTZ,
  cancelado_motivo          TEXT,

  criado_em                 TIMESTAMPTZ DEFAULT NOW(),
  criado_por                INTEGER,   -- usuario id
  atualizado_em             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atendimentos_empresa_data ON atendimentos(empresa_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_atendimentos_prof_data ON atendimentos(profissional_id, data);
CREATE INDEX IF NOT EXISTS idx_atendimentos_cliente ON atendimentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_agendamento ON atendimentos(agendamento_id);
