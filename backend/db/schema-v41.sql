-- Migration v41: Índices de performance para tabela entradas
-- Necessário quando empresas têm milhares de entradas (ex: migração legada)

CREATE INDEX IF NOT EXISTS idx_entradas_empresa_data ON entradas(empresa_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_entradas_empresa_fornecedor ON entradas(empresa_id, fornecedor);
CREATE INDEX IF NOT EXISTS idx_entradas_empresa_id ON entradas(empresa_id, id DESC);

-- Também garantir na notas_saida (mesma otimização)
CREATE INDEX IF NOT EXISTS idx_notas_saida_empresa_data ON notas_saida(empresa_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_notas_saida_empresa_tipo ON notas_saida(empresa_id, tipo);
CREATE INDEX IF NOT EXISTS idx_notas_saida_empresa_status ON notas_saida(empresa_id, status_nfe);
