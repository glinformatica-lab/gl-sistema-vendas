-- Migration v12
-- Adiciona campos fiscais OPCIONAIS na tabela produtos
-- Esses campos só são preenchidos por clientes do Plano Pro (modulo_fiscal_ativo=true)
-- Cliente do plano básico NÃO precisa preencher nada disso - sistema funciona normal sem eles

-- NCM (Nomenclatura Comum do Mercosul) - 8 dígitos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ncm TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cest TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cfop_padrao TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS origem_mercadoria TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS csosn TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cst TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade_tributavel TEXT;

-- Adiciona certificado A1 na empresa (armazenado em base64, criptografado por cima)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS certificado_a1_conteudo TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS certificado_a1_senha_cripto TEXT;

-- Padrões fiscais da empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfop_padrao_vista TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cfop_padrao_prazo TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS origem_mercadoria_padrao TEXT DEFAULT '0';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS csosn_padrao TEXT;

-- Auditoria de mudanças no certificado (segurança)
CREATE TABLE IF NOT EXISTS auditoria_certificado (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_cert_empresa ON auditoria_certificado(empresa_id);

COMMENT ON COLUMN produtos.ncm IS 'NCM 8 dígitos - obrigatório para emissão fiscal';
COMMENT ON COLUMN empresas.certificado_a1_conteudo IS 'Certificado A1 em base64 (criptografado)';
COMMENT ON COLUMN empresas.certificado_a1_senha_cripto IS 'Senha do certificado criptografada com AES-256';
