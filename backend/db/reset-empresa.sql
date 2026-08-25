-- =====================================================
-- RESET DE MOVIMENTAÇÕES — EMPRESA ESPECÍFICA
-- Reflexo Iluminação e Arte (CNPJ: 01.703.420/0001-05)
-- =====================================================
-- MANTÉM: produtos, clientes, fornecedores, marcas, 
--         transportadoras, usuários, configurações, estoque
-- APAGA:  vendas, orçamentos, cotações, ordens, entradas,
--         contas, caixa, créditos, ambientes, lista compras
-- =====================================================

BEGIN;

-- Busca o ID da empresa pelo CNPJ (aceita formatado ou só números)
DO $$
DECLARE
  v_empresa_id INTEGER;
  v_empresa_nome TEXT;
  v_vendas_del INTEGER;
  v_orc_del INTEGER;
  v_cotacoes_del INTEGER;
  v_ordens_del INTEGER;
  v_entradas_del INTEGER;
  v_cp_del INTEGER;
  v_cr_del INTEGER;
  v_caixa_del INTEGER;
  v_creditos_del INTEGER;
  v_amb_del INTEGER;
  v_lc_del INTEGER;
  v_mov_del INTEGER;
BEGIN
  -- Encontra empresa
  SELECT id, nome INTO v_empresa_id, v_empresa_nome
  FROM empresas
  WHERE REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', '') = '01703420000105'
  LIMIT 1;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa com CNPJ 01.703.420/0001-05 não encontrada!';
  END IF;

  RAISE NOTICE '=== EMPRESA ENCONTRADA ===';
  RAISE NOTICE 'ID: % · Nome: %', v_empresa_id, v_empresa_nome;
  RAISE NOTICE '=== INICIANDO LIMPEZA ===';

  -- ===== 1. VENDAS (afeta contas_receber e créditos via FK CASCADE) =====
  DELETE FROM vendas WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_vendas_del = ROW_COUNT;
  RAISE NOTICE '✓ Vendas apagadas: %', v_vendas_del;

  -- ===== 2. ORÇAMENTOS (e itens de orçamento via CASCADE) =====
  DELETE FROM orcamentos WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_orc_del = ROW_COUNT;
  RAISE NOTICE '✓ Orçamentos apagados: %', v_orc_del;

  -- ===== 3. COTAÇÕES (e tabelas filhas via CASCADE) =====
  DELETE FROM cotacoes WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_cotacoes_del = ROW_COUNT;
  RAISE NOTICE '✓ Cotações apagadas: %', v_cotacoes_del;

  -- ===== 4. ORDENS DE COMPRA (e itens via CASCADE) =====
  DELETE FROM ordens_compra WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_ordens_del = ROW_COUNT;
  RAISE NOTICE '✓ Ordens de compra apagadas: %', v_ordens_del;

  -- ===== 5. ENTRADAS DE MERCADORIA (e itens via CASCADE) =====
  DELETE FROM entradas WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_entradas_del = ROW_COUNT;
  RAISE NOTICE '✓ Entradas apagadas: %', v_entradas_del;

  -- ===== 6. LISTA DE COMPRAS =====
  DELETE FROM lista_compras WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_lc_del = ROW_COUNT;
  RAISE NOTICE '✓ Lista de compras apagada: %', v_lc_del;

  -- ===== 7. CONTAS A PAGAR =====
  DELETE FROM contas_pagar WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_cp_del = ROW_COUNT;
  RAISE NOTICE '✓ Contas a pagar apagadas: %', v_cp_del;

  -- ===== 8. CONTAS A RECEBER =====
  DELETE FROM contas_receber WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_cr_del = ROW_COUNT;
  RAISE NOTICE '✓ Contas a receber apagadas: %', v_cr_del;

  -- ===== 9. CAIXA DIÁRIO / MOVIMENTOS =====
  DELETE FROM caixa_movimentos WHERE empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_caixa_del = ROW_COUNT;
  RAISE NOTICE '✓ Movimentos de caixa apagados: %', v_caixa_del;

  -- Fecha aberturas de caixa (se existir)
  BEGIN
    DELETE FROM caixa_aberturas WHERE empresa_id = v_empresa_id;
  EXCEPTION WHEN undefined_table THEN
    NULL; -- tabela pode não existir
  END;

  -- ===== 10. MOVIMENTOS FINANCEIROS (se existir) =====
  BEGIN
    DELETE FROM movimentos_financeiros WHERE empresa_id = v_empresa_id;
    GET DIAGNOSTICS v_mov_del = ROW_COUNT;
    RAISE NOTICE '✓ Movimentos financeiros apagados: %', v_mov_del;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE '- Tabela movimentos_financeiros não existe (ok)';
  END;

  -- ===== 11. CRÉDITOS DE DEVOLUÇÃO =====
  BEGIN
    DELETE FROM creditos_cliente WHERE empresa_id = v_empresa_id;
    GET DIAGNOSTICS v_creditos_del = ROW_COUNT;
    RAISE NOTICE '✓ Créditos de devolução apagados: %', v_creditos_del;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE '- Tabela creditos_cliente não existe (ok)';
  END;

  -- Zera saldo de crédito dos clientes
  UPDATE clientes SET credito_saldo = 0 WHERE empresa_id = v_empresa_id;
  RAISE NOTICE '✓ Saldo de crédito dos clientes zerado';

  -- ===== 12. AMBIENTES DE ORÇAMENTO =====
  BEGIN
    DELETE FROM ambientes WHERE empresa_id = v_empresa_id;
    GET DIAGNOSTICS v_amb_del = ROW_COUNT;
    RAISE NOTICE '✓ Ambientes apagados: %', v_amb_del;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE '- Tabela ambientes não existe (ok)';
  END;

  -- ===== 13. PEDIDOS ONLINE (se existir) =====
  BEGIN
    DELETE FROM pedidos_online WHERE empresa_id = v_empresa_id;
    RAISE NOTICE '✓ Pedidos online apagados';
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RAISE NOTICE '=== LIMPEZA CONCLUÍDA COM SUCESSO ===';
  RAISE NOTICE 'Cadastros MANTIDOS: produtos, clientes, fornecedores, marcas, transportadoras, usuários';
END $$;

-- Verifique se está tudo certo antes de dar COMMIT!
-- Se algo saiu errado, troque COMMIT por ROLLBACK.

COMMIT;
