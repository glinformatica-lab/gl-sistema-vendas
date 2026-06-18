-- Migration v18: converter dados antigos pra MAIÚSCULA
-- Aplica em campos de texto comuns - PRESERVA emails, URLs, códigos técnicos e senhas

-- ====== CLIENTES ======
UPDATE clientes SET
  nome      = UPPER(nome)      WHERE nome      IS NOT NULL AND nome      != UPPER(nome);
UPDATE clientes SET
  endereco  = UPPER(endereco)  WHERE endereco  IS NOT NULL AND endereco  != UPPER(endereco);
UPDATE clientes SET
  bairro    = UPPER(bairro)    WHERE bairro    IS NOT NULL AND bairro    != UPPER(bairro);
UPDATE clientes SET
  cidade    = UPPER(cidade)    WHERE cidade    IS NOT NULL AND cidade    != UPPER(cidade);
UPDATE clientes SET
  uf        = UPPER(uf)        WHERE uf        IS NOT NULL AND uf        != UPPER(uf);
UPDATE clientes SET
  observacoes = UPPER(observacoes) WHERE observacoes IS NOT NULL AND observacoes != UPPER(observacoes);
-- NÃO converte: email (case-sensitive), doc/cpf/cnpj (só números), telefone

-- ====== FORNECEDORES ======
UPDATE fornecedores SET
  nome      = UPPER(nome)      WHERE nome      IS NOT NULL AND nome      != UPPER(nome);
UPDATE fornecedores SET
  endereco  = UPPER(endereco)  WHERE endereco  IS NOT NULL AND endereco  != UPPER(endereco);
UPDATE fornecedores SET
  cidade    = UPPER(cidade)    WHERE cidade    IS NOT NULL AND cidade    != UPPER(cidade);
UPDATE fornecedores SET
  uf        = UPPER(uf)        WHERE uf        IS NOT NULL AND uf        != UPPER(uf);
-- NÃO converte: email, cnpj, telefone

-- ====== PRODUTOS ======
UPDATE produtos SET
  nome       = UPPER(nome)       WHERE nome       IS NOT NULL AND nome       != UPPER(nome);
UPDATE produtos SET
  categoria  = UPPER(categoria)  WHERE categoria  IS NOT NULL AND categoria  != UPPER(categoria);
UPDATE produtos SET
  fornecedor = UPPER(fornecedor) WHERE fornecedor IS NOT NULL AND fornecedor != UPPER(fornecedor);
-- NÃO converte: codigo, codigo_barras, ncm, cest, cfop_padrao, csosn, cst (códigos técnicos)
-- NÃO converte: foto_url (URL técnica)

-- ====== SERVIÇOS (se a tabela existir) ======
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'servicos') THEN
    UPDATE servicos SET nome = UPPER(nome) WHERE nome IS NOT NULL AND nome != UPPER(nome);
    UPDATE servicos SET descricao = UPPER(descricao) WHERE descricao IS NOT NULL AND descricao != UPPER(descricao);
  END IF;
END $$;

-- ====== VENDAS ======
UPDATE vendas SET
  cliente    = UPPER(cliente)    WHERE cliente    IS NOT NULL AND cliente    != UPPER(cliente);
UPDATE vendas SET
  observacoes = UPPER(observacoes) WHERE observacoes IS NOT NULL AND observacoes != UPPER(observacoes);
UPDATE vendas SET
  motivo_cancelamento = UPPER(motivo_cancelamento) WHERE motivo_cancelamento IS NOT NULL AND motivo_cancelamento != UPPER(motivo_cancelamento);

-- ====== ITENS DE VENDA (se for tabela separada) ======
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'itens_venda') THEN
    UPDATE itens_venda SET produto = UPPER(produto) WHERE produto IS NOT NULL AND produto != UPPER(produto);
  END IF;
END $$;

-- ====== ORÇAMENTOS (se existir) ======
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orcamentos') THEN
    UPDATE orcamentos SET cliente = UPPER(cliente) WHERE cliente IS NOT NULL AND cliente != UPPER(cliente);
    UPDATE orcamentos SET observacoes = UPPER(observacoes) WHERE observacoes IS NOT NULL AND observacoes != UPPER(observacoes);
  END IF;
END $$;

-- ====== CONTAS A RECEBER ======
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contas_receber') THEN
    UPDATE contas_receber SET descricao = UPPER(descricao) WHERE descricao IS NOT NULL AND descricao != UPPER(descricao);
    UPDATE contas_receber SET cliente = UPPER(cliente) WHERE cliente IS NOT NULL AND cliente != UPPER(cliente);
  END IF;
END $$;

-- ====== CONTAS A PAGAR ======
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contas_pagar') THEN
    UPDATE contas_pagar SET descricao = UPPER(descricao) WHERE descricao IS NOT NULL AND descricao != UPPER(descricao);
    UPDATE contas_pagar SET fornecedor = UPPER(fornecedor) WHERE fornecedor IS NOT NULL AND fornecedor != UPPER(fornecedor);
    UPDATE contas_pagar SET categoria = UPPER(categoria) WHERE categoria IS NOT NULL AND categoria != UPPER(categoria);
  END IF;
END $$;

-- ====== EMPRESAS ======
UPDATE empresas SET
  nome = UPPER(nome) WHERE nome IS NOT NULL AND nome != UPPER(nome);
UPDATE empresas SET
  endereco = UPPER(endereco) WHERE endereco IS NOT NULL AND endereco != UPPER(endereco);
-- NÃO converte: cnpj, email, telefone

-- ====== USUÁRIOS ======
UPDATE usuarios SET
  nome = UPPER(nome) WHERE nome IS NOT NULL AND nome != UPPER(nome);
-- NÃO converte: email (login!), senha_hash (NUNCA)
