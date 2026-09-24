// ============================================
// CLIENTE HTTP DA API HIPER (nuvem)
// Faz autenticação com chave, guarda token, chama endpoints.
// ============================================
const https = require('https');

const HIPER_BASE = 'https://ms-ecommerce.hiper.com.br/api/v1';

// Cache de tokens por empresa (evita gerar novo token a cada call)
// Token JWT do Hiper dura ~6h; renovamos com 30min de folga
const _tokenCache = new Map(); // empresaId -> { token, expiresAt }

function httpsRequest(url, method = 'GET', token = null, body = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      headers: {
        'Accept': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      timeout: timeoutMs
    };
    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout na API Hiper')); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Gera (ou reusa) token de autenticação Hiper
async function obterToken(empresaId, chaveApi) {
  if (!chaveApi) throw new Error('Chave da API Hiper não configurada.');
  const cached = _tokenCache.get(empresaId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const url = `${HIPER_BASE}/auth/gerar-token/${encodeURIComponent(chaveApi)}`;
  const r = await httpsRequest(url, 'GET');
  if (!r.token) throw new Error(r.message || 'Não recebeu token');
  // Guarda por 5h30 (token dura 6h)
  _tokenCache.set(empresaId, {
    token: r.token,
    expiresAt: Date.now() + (5 * 60 + 30) * 60 * 1000
  });
  return r.token;
}

// Lista produtos a partir de um ponto de sincronização
async function listarProdutos(empresaId, chaveApi, pontoDeSincronizacao = 0) {
  const token = await obterToken(empresaId, chaveApi);
  const url = `${HIPER_BASE}/produtos/pontoDeSincronizacao?pontoDeSincronizacao=${pontoDeSincronizacao}`;
  return await httpsRequest(url, 'GET', token, null, 30000);
}

// Estoque de um produto específico
async function estoqueProduto(empresaId, chaveApi, produtoId) {
  const token = await obterToken(empresaId, chaveApi);
  const url = `${HIPER_BASE}/estoques/pontoDeSincronizacao?ProdutoId=${encodeURIComponent(produtoId)}`;
  return await httpsRequest(url, 'GET', token, null, 10000);
}

// Testa credenciais (usado pela tela de configuração)
async function testarCredenciais(chaveApi) {
  try {
    const url = `${HIPER_BASE}/auth/gerar-token/${encodeURIComponent(chaveApi)}`;
    const r = await httpsRequest(url, 'GET');
    return { ok: !!r.token, mensagem: r.token ? 'Credenciais válidas!' : (r.message || 'Sem token') };
  } catch (e) {
    return { ok: false, mensagem: e.message };
  }
}

module.exports = { obterToken, listarProdutos, estoqueProduto, testarCredenciais };
