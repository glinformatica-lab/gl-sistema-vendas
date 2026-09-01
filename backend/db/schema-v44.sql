-- Migration v44: Módulo Salão - Agendamentos
-- Simplificado: hora início + 1h fixo (dona pode ajustar via edição)

CREATE TABLE IF NOT EXISTS agendamentos (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  profissional_id       INTEGER NOT NULL REFERENCES profissionais(id),

  -- Cliente: pode ser cadastrado OU avulso
  cliente_id            INTEGER REFERENCES clientes(id),
  cliente_nome          TEXT NOT NULL,       -- sempre preenchido (avulso ou cópia do cadastrado)
  cliente_telefone      TEXT,

  -- Horário: dona informa início; fim = início + duração_min
  data                  DATE NOT NULL,
  hora_inicio           TIME NOT NULL,
  duracao_min           INTEGER DEFAULT 60,   -- 1 hora por padrão

  -- Serviço previsto (opcional; pode ser vazio se dona só quer marcar horário)
  servico_id            INTEGER REFERENCES servicos_salao(id),
  servico_nome          TEXT,                 -- snapshot pra histórico

  -- Status: 'agendado' | 'atendido' | 'cancelado'
  status                TEXT NOT NULL DEFAULT 'agendado',

  -- Se vira atendimento, guarda o link
  atendimento_id        INTEGER,

  observacoes           TEXT,
  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agendamentos_empresa_data ON agendamentos(empresa_id, data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_prof_data ON agendamentos(profissional_id, data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_cliente ON agendamentos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_status ON agendamentos(empresa_id, status);
