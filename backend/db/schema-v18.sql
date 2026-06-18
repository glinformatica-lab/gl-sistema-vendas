-- Migration v18 (corrigida): converte dados antigos pra MAIÚSCULA
-- VERSÃO DEFENSIVA: testa se a coluna existe antes de atualizar
-- Preserva e-mails, senhas, URLs, códigos técnicos

-- Helper function: aplica UPPER somente se a coluna existir
CREATE OR REPLACE FUNCTION upper_se_existe(tabela TEXT, coluna TEXT) RETURNS VOID AS $$
DECLARE
  existe BOOLEAN;
BEGIN
  -- Verifica se a tabela existe
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = tabela
  ) INTO existe;
  IF NOT existe THEN
    RETURN;
  END IF;
  -- Verifica se a coluna existe na tabela
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = tabela AND column_name = coluna
  ) INTO existe;
  IF NOT existe THEN
    RETURN;
  END IF;
  -- Executa o UPDATE de forma segura
  EXECUTE format(
    'UPDATE %I SET %I = UPPER(%I) WHERE %I IS NOT NULL AND %I != UPPER(%I)',
    tabela, coluna, coluna, coluna, coluna, coluna
  );
END;
$$ LANGUAGE plpgsql;

-- ====== CLIENTES ======
SELECT upper_se_existe('clientes', 'nome');
SELECT upper_se_existe('clientes', 'endereco');
SELECT upper_se_existe('clientes', 'bairro');
SELECT upper_se_existe('clientes', 'cidade');
SELECT upper_se_existe('clientes', 'uf');
SELECT upper_se_existe('clientes', 'observacoes');
SELECT upper_se_existe('clientes', 'observacao');
SELECT upper_se_existe('clientes', 'obs');
SELECT upper_se_existe('clientes', 'complemento');

-- ====== FORNECEDORES ======
SELECT upper_se_existe('fornecedores', 'nome');
SELECT upper_se_existe('fornecedores', 'endereco');
SELECT upper_se_existe('fornecedores', 'cidade');
SELECT upper_se_existe('fornecedores', 'uf');
SELECT upper_se_existe('fornecedores', 'observacoes');
SELECT upper_se_existe('fornecedores', 'observacao');

-- ====== PRODUTOS ======
SELECT upper_se_existe('produtos', 'nome');
SELECT upper_se_existe('produtos', 'categoria');
SELECT upper_se_existe('produtos', 'fornecedor');
SELECT upper_se_existe('produtos', 'descricao');
SELECT upper_se_existe('produtos', 'observacoes');

-- ====== SERVIÇOS ======
SELECT upper_se_existe('servicos', 'nome');
SELECT upper_se_existe('servicos', 'descricao');

-- ====== VENDAS ======
SELECT upper_se_existe('vendas', 'cliente');
SELECT upper_se_existe('vendas', 'observacoes');
SELECT upper_se_existe('vendas', 'observacao');
SELECT upper_se_existe('vendas', 'obs');
SELECT upper_se_existe('vendas', 'motivo_cancelamento');

-- ====== ITENS DE VENDA ======
SELECT upper_se_existe('itens_venda', 'produto');
SELECT upper_se_existe('itens_venda', 'nome');
SELECT upper_se_existe('itens_venda', 'descricao');

-- ====== ORÇAMENTOS ======
SELECT upper_se_existe('orcamentos', 'cliente');
SELECT upper_se_existe('orcamentos', 'observacoes');
SELECT upper_se_existe('orcamentos', 'observacao');
SELECT upper_se_existe('orcamentos', 'obs');

-- ====== CONTAS A RECEBER ======
SELECT upper_se_existe('contas_receber', 'descricao');
SELECT upper_se_existe('contas_receber', 'cliente');
SELECT upper_se_existe('contas_receber', 'categoria');

-- ====== CONTAS A PAGAR ======
SELECT upper_se_existe('contas_pagar', 'descricao');
SELECT upper_se_existe('contas_pagar', 'fornecedor');
SELECT upper_se_existe('contas_pagar', 'categoria');

-- ====== EMPRESAS ======
SELECT upper_se_existe('empresas', 'nome');
SELECT upper_se_existe('empresas', 'endereco');
SELECT upper_se_existe('empresas', 'cidade');
SELECT upper_se_existe('empresas', 'bairro');

-- ====== USUÁRIOS ======
SELECT upper_se_existe('usuarios', 'nome');

-- ====== MOVIMENTAÇÕES ======
SELECT upper_se_existe('movimentacoes', 'produto_nome');
SELECT upper_se_existe('movimentacoes', 'origem');

-- ====== ENTRADAS (compras) ======
SELECT upper_se_existe('entradas', 'fornecedor');
SELECT upper_se_existe('entradas', 'observacoes');

-- Limpa a função helper depois de usar
DROP FUNCTION IF EXISTS upper_se_existe(TEXT, TEXT);
