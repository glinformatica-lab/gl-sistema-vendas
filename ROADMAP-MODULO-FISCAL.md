# 🧾 ROADMAP — MÓDULO FISCAL GL SISTEMA

**Data:** 01/09/2026
**Status:** Aguardando primeira venda do módulo pra implementar
**Estratégia:** Preparar tudo que é gratuito, sem mexer no que já funciona

---

## 📊 O QUE JÁ EXISTE (não precisa refazer)

### ✅ Infraestrutura pronta
- Feature toggle `empresa.moduloFiscalAtivo`
- Classe CSS `.fiscal-only` (mostra/esconde por plano)
- Página `configuracoes-fiscais` (esqueleto pronto)
- Upload de certificado A1 com criptografia (`CERT_ENCRYPTION_KEY`)
- Endpoint `DELETE /api/fiscal/certificado`
- Menu "🧾 Fiscal" (feature-ambientes)

### ✅ Estrutura de dados pronta
- Tabela `notas_saida` (id, chave, status_nfe, tipo, cfop, etc)
- Tabela `notas_saida_itens` (produto, cfop, ncm, quantidade, etc)
- Vendas linkadas com notas via `venda_id`

### ✅ Integração escolhida
- **Focus NFe** (https://focusnfe.com.br)
- Token homologação já obtido: `HTAY9BHiiZucj7lK8ETgZ6DIDUmjrOZr`

### ✅ Frontend fiscal já parcial
- Parser XML de NFe (`parseXmlNfe`) para importar entradas
- Tela de Notas Fiscais de Saída (leitura, com filtros)

---

## 🎯 O QUE FALTA IMPLEMENTAR

### 📁 FASE 0 — Cadastros fiscais (BASE)
**Tempo estimado:** 3-5 dias
**Depende de:** nada

#### Empresa (novos campos)
```sql
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS regime_tributario TEXT;
  -- 'simples' | 'presumido' | 'real' | 'mei'
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ie TEXT;
  -- Inscrição Estadual
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS im TEXT;
  -- Inscrição Municipal
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cnae TEXT;
  -- Código CNAE principal
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ambiente_nfe TEXT DEFAULT 'homologacao';
  -- 'homologacao' | 'producao'
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS proxima_nfe_numero INT DEFAULT 1;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS proxima_nfe_serie INT DEFAULT 1;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS proxima_nfce_numero INT DEFAULT 1;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS proxima_nfce_serie INT DEFAULT 1;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS csc_id TEXT;
  -- Código de Segurança do Contribuinte (NFC-e)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS csc_token TEXT;
```

#### Produtos (novos campos)
```sql
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ncm TEXT;
  -- Nomenclatura Comum do Mercosul (8 dígitos)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cest TEXT;
  -- Código Especificador da Substituição Tributária
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cfop_saida TEXT DEFAULT '5102';
  -- Padrão: venda dentro do estado
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade_tributavel TEXT DEFAULT 'UN';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS origem_mercadoria INT DEFAULT 0;
  -- 0=Nacional, 1=Estrangeira Importação, 2=Estrangeira Interna, etc
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cst_icms TEXT;
  -- Lucro Real/Presumido: '00', '10', '20', etc
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS csosn TEXT;
  -- Simples Nacional: '101', '102', '400', etc
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS aliquota_icms NUMERIC DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cst_pis TEXT DEFAULT '99';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS aliquota_pis NUMERIC DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cst_cofins TEXT DEFAULT '99';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS aliquota_cofins NUMERIC DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cst_ipi TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS aliquota_ipi NUMERIC DEFAULT 0;
```

#### Clientes (novos campos)
```sql
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ie TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS indicador_ie INT DEFAULT 9;
  -- 1=Contribuinte, 2=Isento, 9=Não Contribuinte
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS consumidor_final BOOLEAN DEFAULT TRUE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS suframa TEXT;
  -- Inscrição SUFRAMA (Zona Franca de Manaus)
```

#### Rotas backend novas
- `PUT /api/empresas/fiscal` — atualiza regime, IE, IM, CNAE
- `POST /api/fiscal/csc` — configura CSC pra NFC-e
- `GET /api/fiscal/proximos-numeros` — retorna próximo número NFe/NFCe
- `PUT /api/produtos/:id/fiscal` — atualiza campos fiscais em lote

#### UI necessária
- Aba "Fiscal" em Configurações (regime, IE, CNAE, ambiente)
- Aba "Fiscal" no cadastro/edição de Produto
- Campos "IE" e "Indicador IE" no cadastro de Cliente
- Bulk edit: aplicar CFOP/NCM em vários produtos de uma vez

---

### 📁 FASE 1 — Emissão de NFe simples
**Tempo estimado:** 1 semana
**Depende de:** Fase 0

#### Nova rota (server)
- `POST /api/fiscal/nfe/emitir` — recebe venda_id, monta JSON e envia pro Focus
- `POST /api/fiscal/nfe/callback` — webhook do Focus com autorização/rejeição
- `GET /api/fiscal/nfe/status/:ref` — consulta status atualizado
- `POST /api/fiscal/nfe/cancelar` — cancela NFe autorizada
- `POST /api/fiscal/nfe/cce` — carta de correção

#### Fluxo esperado
```
1. Venda salva → Botão "Emitir NFe" aparece
2. Clica → Backend monta JSON com dados da venda
3. Backend envia pra Focus NFe (POST /v2/nfe)
4. Focus retorna: processando_autorizacao
5. Focus autoriza (segundos)
6. Callback recebido → salva chave + XML + status "autorizada"
7. Botão vira "Ver DANFE" | "Cancelar" | "CC-e"
```

#### Estrutura JSON pra Focus
```json
{
  "natureza_operacao": "Venda de mercadoria",
  "data_emissao": "2026-09-01T10:00:00-03:00",
  "tipo_documento": 1,
  "finalidade_emissao": 1,
  "cnpj_emitente": "01703420000105",
  "nome_destinatario": "João Silva",
  "cpf_destinatario": "12345678900",
  "logradouro_destinatario": "Rua X, 100",
  "bairro_destinatario": "Centro",
  "municipio_destinatario": "Goiânia",
  "uf_destinatario": "GO",
  "cep_destinatario": "74000000",
  "valor_produtos": 100.00,
  "valor_total": 100.00,
  "items": [
    {
      "numero_item": 1,
      "codigo_produto": "0033122",
      "descricao": "EMB BR/PT 5PONTOS LED 10W",
      "cfop": "5102",
      "unidade_comercial": "UN",
      "quantidade_comercial": 1,
      "valor_unitario_comercial": 100.00,
      "ncm": "94054000",
      "icms_origem": 0,
      "icms_situacao_tributaria": "102",
      "pis_situacao_tributaria": "99",
      "cofins_situacao_tributaria": "99"
    }
  ]
}
```

---

### 📁 FASE 2 — Cálculo de impostos
**Tempo estimado:** 2-4 semanas (mais complexa)
**Depende de:** Fase 1

- Regras por regime (Simples é MAIS SIMPLES, Lucro Real é infernal)
- Alíquotas por UF de destino
- Substituição tributária (ST) — MUITO complexo
- DIFAL (venda interestadual pra consumidor final)
- PIS/COFINS conforme regime
- ICMS-ST antecipado

**Recomendação:** começar SÓ com Simples Nacional. Cobre 90% dos micro-empresários.

---

### 📁 FASE 3 — NFC-e (varejo)
**Tempo estimado:** 3-5 dias
**Depende de:** Fase 1

- Emissão em tempo real no ato da venda
- QR Code obrigatório
- Impressão em cupom não fiscal
- Contingência offline

---

### 📁 FASE 4 — DANFE (PDF)
**Tempo estimado:** 2-3 dias
**Depende de:** Fase 1

- Focus NFe já gera DANFE em PDF
- Só precisa baixar e mostrar no botão "Ver DANFE"
- Layout obrigatório da Sefaz (Focus cuida)

---

### 📁 FASE 5 — Contingência e robustez
**Tempo estimado:** 1 semana
**Depende de:** Fase 1

- Modo offline se Sefaz cair
- Reenvio automático
- Fila de emissões pendentes
- Alertas de rejeições

---

### 📁 FASE 6 — Homologação SEFAZ
**Tempo estimado:** 2-4 semanas
**Depende de:** tudo acima

- 100+ testes obrigatórios da Sefaz
- Certificação para produção
- Migração ambiente HOMOLOG → PRODUÇÃO

---

## 💰 CUSTOS ESTIMADOS PRA O CLIENTE

```
Certificado A1
   ├─ Anual: R$ 150-300 (renovação obrigatória)
   └─ Fornecedores: Serasa, Certisign, Soluti, Valid

Focus NFe (por CNPJ)
   ├─ Plano NFe: R$ 100-150/mês (até X notas)
   ├─ Plano NFC-e: +R$ 50-80/mês
   └─ Documentação: https://focusnfe.com.br/precos

Total mensal por cliente
   └─ ~R$ 150-250/mês (varia com volume)
```

**Sugestão de precificação:**
- Plano Pro Fiscal: R$ 199-299/mês
- Repassar custo do Focus + margem
- Certificado A1 fica por conta do cliente

---

## 🚨 PONTOS DE ATENÇÃO

### Responsabilidade fiscal
- Erros no cálculo podem gerar MULTA pro cliente
- Sua empresa (GL) pode ser responsabilizada solidariamente
- **AÇÃO OBRIGATÓRIA:** Termo de Uso deixando claro que:
  - Cliente é responsável pela veracidade dos dados
  - GL não se responsabiliza por classificação fiscal errada
  - Cliente deve ter contador validando

### Suporte
- Rejeições da Sefaz acontecem 24/7
- Cliente vai ligar com urgência quando não emitir
- Precisa ter:
  - FAQ com códigos comuns
  - Canal de suporte prioritário
  - SLA definido

### Certificado A1
- Vence em 1 ano
- Precisa alerta 30/15/7 dias antes
- Renovação exige upload novo

---

## 📞 CONTATOS ÚTEIS

- **Focus NFe:** contato@focusnfe.com.br | (44) 3220-4444
- **Sefaz GO:** https://www.sefaz.go.gov.br
- **Portal NFe Nacional:** https://www.nfe.fazenda.gov.br
- **Manual NFe:** https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=NT2019.001

---

## 🎯 QUANDO ME CHAMAR

**Quando você fechar a primeira venda do módulo fiscal**, me manda essa mensagem:

> "Vamos começar o módulo fiscal — cliente é [nome], CNPJ [x], regime [simples/presumido/real].
> Já tenho o certificado A1 dele e a conta Focus NFe.
> Vamos pela Fase 0."

E aí a gente executa passo a passo, cada fase de cada vez.

---

## ✅ CHECKLIST PRÉ-IMPLEMENTAÇÃO

Antes de começar, tenha em mãos:

- [ ] CNPJ do cliente
- [ ] Regime tributário (Simples/Presumido/Real)
- [ ] Inscrição Estadual (IE)
- [ ] Certificado A1 (.pfx) + senha
- [ ] Conta Focus NFe criada + token de produção
- [ ] CSC (para NFC-e) obtido na Sefaz
- [ ] Contador do cliente identificado
- [ ] Termo de responsabilidade assinado
- [ ] Cliente treinado nos códigos fiscais (NCM, CFOP)

---

**Última atualização:** 01/09/2026
**Próxima revisão:** Quando primeira venda do módulo cair
