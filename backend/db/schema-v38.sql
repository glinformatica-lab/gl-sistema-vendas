-- Migration v38: Campos adicionais para Fornecedores
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(30);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS telefone VARCHAR(30);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cidade VARCHAR(120);
