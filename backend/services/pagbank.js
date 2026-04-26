// Wrapper das chamadas à API de Checkout do PagBank.
// Documentação: https://developer.pagbank.com.br/docs/checkout
//
// Variáveis de ambiente esperadas:
//   PAGBANK_TOKEN     — token de integração da conta PagBank
//   PAGBANK_AMBIENTE  — 'sandbox' ou 'production' (default: sandbox)
//   APP_URL           — URL pública do app (ex: https://gl-sistema-vendas.onrender.com)
//                       usada para callbacks e webhook

const TOKEN = process.env.PAGBANK_TOKEN;
const AMBIENTE = (process.env.PAGBANK_AMBIENTE || 'sandbox').toLowerCase();
const APP_URL = process.env.APP_URL || '';

const BASE_URL = AMBIENTE === 'production'
  ? 'https://api.pagseguro.com'
  : 'https://sandbox.api.pagseguro.com';

function tokenConfigurado() {
  return !!TOKEN;
}

// Cria um Checkout no PagBank e devolve o link de pagamento + ID
//
// Parâmetros:
//   referencia  — string única do nosso lado (id da assinatura)
//   valor       — número (ex: 99.00) — converte para centavos automaticamente
//   descricao   — descrição do item (ex: "Plano Mensal — GL Sistema de Vendas")
//   email       — e-mail do comprador
//   nome        — nome do comprador
//   formas      — array com formas aceitas: ['CREDIT_CARD', 'BOLETO', 'PIX']
//   maxParcelas — número máximo de parcelas no cartão (default 1)
async function criarCheckout({ referencia, valor, descricao, email, nome, formas, maxParcelas }) {
  if (!TOKEN) {
    throw new Error('Token do PagBank não configurado. Defina PAGBANK_TOKEN no .env.');
  }
  const valorCentavos = Math.round(Number(valor) * 100);
  const formasPgto = (formas && formas.length > 0)
    ? formas
    : ['CREDIT_CARD', 'BOLETO', 'PIX'];

  // PagBank só aceita URLs HTTPS válidas. Em localhost, omitimos.
  const urlsValidas = APP_URL && APP_URL.startsWith('https://');

  const payload = {
    reference_id: referencia,
    expiration_date: dataExpiracaoIso(7), // 7 dias para pagar
    customer_modifiable: true,
    items: [{
      reference_id: referencia,
      name: descricao,
      quantity: 1,
      unit_amount: valorCentavos
    }],
    customer: nome && email ? {
      name: String(nome).slice(0, 60),
      email: String(email).slice(0, 60)
    } : undefined,
    payment_methods: formasPgto.map(f => ({ type: f }))
  };

  // Configurações de parcelamento - só para CREDIT_CARD
  if (formasPgto.includes('CREDIT_CARD') && maxParcelas && maxParcelas > 1) {
    payload.payment_methods_configs = [{
      type: 'CREDIT_CARD',
      config_options: [
        { option: 'INSTALLMENTS_LIMIT', value: String(maxParcelas) },
        { option: 'INTEREST_FREE_INSTALLMENTS', value: String(maxParcelas) }
      ]
    }];
  }

  // URLs de retorno e webhook - só se APP_URL for HTTPS público
  if (urlsValidas) {
    payload.redirect_url = `${APP_URL}/assinatura-sucesso.html?ref=${encodeURIComponent(referencia)}`;
    payload.return_url   = `${APP_URL}/assinatura-sucesso.html?ref=${encodeURIComponent(referencia)}`;
    payload.notification_urls = [`${APP_URL}/api/assinaturas/webhook`];
    payload.payment_notification_urls = [`${APP_URL}/api/assinaturas/webhook`];
  }

  // Remove campos undefined
  if (!payload.customer) delete payload.customer;

  const r = await fetch(`${BASE_URL}/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      'x-api-version': '4.0'
    },
    body: JSON.stringify(payload)
  });

  let data;
  try { data = await r.json(); } catch(_) { data = null; }

  if (!r.ok) {
    const msg = data?.error_messages?.[0]?.description || data?.message || `HTTP ${r.status}`;
    const err = new Error(`PagBank: ${msg}`);
    err.statusCode = r.status;
    err.responseBody = data;
    throw err;
  }

  // Procura o link "PAY" para redirecionamento do comprador
  const linkPay = data.links?.find(l => l.rel === 'PAY')?.href;

  return {
    checkoutId: data.id,
    linkPagamento: linkPay,
    raw: data,
    payload
  };
}

// Consulta um checkout pelo ID
async function consultarCheckout(checkoutId) {
  if (!TOKEN) throw new Error('Token do PagBank não configurado.');
  const r = await fetch(`${BASE_URL}/checkouts/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      'x-api-version': '4.0'
    }
  });
  let data; try { data = await r.json(); } catch(_) { data = null; }
  if (!r.ok) {
    const msg = data?.error_messages?.[0]?.description || data?.message || `HTTP ${r.status}`;
    throw new Error(`PagBank: ${msg}`);
  }
  return data;
}

// Consulta um pedido (order) pelo ID — usado para checar status de pagamento via webhook
async function consultarPedido(pedidoId) {
  if (!TOKEN) throw new Error('Token do PagBank não configurado.');
  const r = await fetch(`${BASE_URL}/orders/${encodeURIComponent(pedidoId)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      'x-api-version': '4.0'
    }
  });
  let data; try { data = await r.json(); } catch(_) { data = null; }
  if (!r.ok) {
    const msg = data?.error_messages?.[0]?.description || data?.message || `HTTP ${r.status}`;
    throw new Error(`PagBank: ${msg}`);
  }
  return data;
}

// Helper: data ISO N dias no futuro no formato esperado pelo PagBank (com fuso BR)
function dataExpiracaoIso(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  // Formato: 2025-04-30T23:59:59-03:00
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T23:59:59-03:00`;
}

module.exports = {
  tokenConfigurado,
  criarCheckout,
  consultarCheckout,
  consultarPedido,
  ambiente: AMBIENTE,
  baseUrl: BASE_URL
};
