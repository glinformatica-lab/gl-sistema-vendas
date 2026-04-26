-- Migration v4: assinaturas self-service via gateway de pagamento
-- Idempotente.

CREATE TABLE IF NOT EXISTS assinaturas (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE SET NULL,
  -- referência interna usada no PagBank (reference_id)
  referencia TEXT UNIQUE NOT NULL,
  -- ID do checkout retornado pelo PagBank (CHEC_xxx)
  checkout_id TEXT,
  -- ID do pedido PagBank quando criar (ORDE_xxx)
  pedido_id TEXT,
  plano TEXT NOT NULL CHECK (plano IN ('mensal', 'anual')),
  valor NUMERIC(14,2) NOT NULL,
  link_pagamento TEXT,
  -- pendente | paga | recusada | expirada | cancelada
  status TEXT NOT NULL DEFAULT 'pendente',
  -- forma usada no pagamento: PIX, CREDIT_CARD, BOLETO, etc.
  forma_pagamento TEXT,
  -- e-mail do admin que se cadastrou (para reenviar dados de acesso)
  email_contato TEXT,
  payload_inicial JSONB, -- request enviado ao PagBank
  ultimo_retorno JSONB, -- última resposta/webhook recebido do PagBank
  data_pagamento TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assinaturas_empresa ON assinaturas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_status ON assinaturas(status);
CREATE INDEX IF NOT EXISTS idx_assinaturas_referencia ON assinaturas(referencia);

-- Adiciona um status novo para "aguardando-pagamento" em empresas
-- (não usamos CHECK constraint para flexibilidade, valores válidos:
--  trial | ativa | vencida | bloqueada | aguardando-pagamento | cancelada)
