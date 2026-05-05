-- Migration v10
-- Migra itens 'avulso' antigos pra serviços cadastrados
-- Pra cada empresa: pega itens avulsos distintos, cria serviço com mesmo nome,
-- atualiza orcamento_itens pra apontar pro serviço criado e mudar tipo='servico'

DO $$
DECLARE
  rec RECORD;
  novo_servico_id INTEGER;
BEGIN
  -- Loop em cada combinação distinta (empresa, descricao) dos itens avulsos
  FOR rec IN (
    SELECT DISTINCT o.empresa_id, oi.descricao, oi.valor_unitario
    FROM orcamento_itens oi
    JOIN orcamentos o ON o.id = oi.orcamento_id
    WHERE oi.tipo = 'avulso'
      AND oi.descricao IS NOT NULL
      AND TRIM(oi.descricao) != ''
  ) LOOP
    -- Verifica se já existe serviço com esse nome na empresa
    SELECT id INTO novo_servico_id
    FROM servicos
    WHERE empresa_id = rec.empresa_id
      AND LOWER(nome) = LOWER(rec.descricao)
      AND ativo = TRUE
    LIMIT 1;

    -- Se não existe, cria
    IF novo_servico_id IS NULL THEN
      INSERT INTO servicos (empresa_id, nome, descricao, valor, ativo)
      VALUES (rec.empresa_id, rec.descricao,
              'Migrado automaticamente de item avulso de orçamento',
              rec.valor_unitario, TRUE)
      RETURNING id INTO novo_servico_id;
      RAISE NOTICE 'Criado serviço "%" (empresa %) com valor R$ %',
        rec.descricao, rec.empresa_id, rec.valor_unitario;
    END IF;

    -- Atualiza todos os itens avulsos com essa descrição na empresa
    UPDATE orcamento_itens oi
    SET tipo = 'servico', servico_id = novo_servico_id
    FROM orcamentos o
    WHERE oi.orcamento_id = o.id
      AND o.empresa_id = rec.empresa_id
      AND oi.tipo = 'avulso'
      AND LOWER(oi.descricao) = LOWER(rec.descricao);
  END LOOP;
END $$;
