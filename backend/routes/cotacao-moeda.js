// ============================================
// COTAÇÕES DE MOEDA (Euro, Dólar, etc)
// Busca cotação via AwesomeAPI, com cache no banco.
// Fallbacks em cascata: AwesomeAPI -> cache mais recente -> erro amigável
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const https = require('https');

const MOEDAS_ACEITAS = ['EUR', 'USD', 'GBP', 'ARS', 'JPY', 'CHF'];

// Helper: faz GET HTTPS retornando JSON (sem depender de fetch/axios)
function httpsGetJson(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Resposta não é JSON válido')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

// GET /:moeda — Retorna cotação de HOJE (com cache diário)
// Exemplo: GET /api/cotacao-moeda/EUR
router.get('/:moeda', async (req, res) => {
  try {
    const moeda = String(req.params.moeda || '').toUpperCase();
    if (!MOEDAS_ACEITAS.includes(moeda)) {
      return res.status(400).json({ error: `Moeda inválida. Aceitas: ${MOEDAS_ACEITAS.join(', ')}` });
    }

    const hoje = new Date().toISOString().slice(0, 10);

    // 1) Tenta cache do dia
    const cache = await db.query(
      'SELECT cotacao, fonte, buscada_em FROM cotacoes_cache WHERE moeda=$1 AND data=$2',
      [moeda, hoje]
    );
    if (cache.rows.length > 0) {
      return res.json({
        moeda, data: hoje,
        cotacao: Number(cache.rows[0].cotacao),
        fonte: cache.rows[0].fonte,
        cache: true
      });
    }

    // 2) Busca online (AwesomeAPI)
    let cotacao = null;
    let fonte = null;
    try {
      const url = `https://economia.awesomeapi.com.br/last/${moeda}-BRL`;
      const data = await httpsGetJson(url, 4000);
      const chave = `${moeda}BRL`;
      const item = data[chave];
      if (item && item.bid) {
        cotacao = Number(item.bid);
        fonte = 'awesomeapi';
      }
    } catch (err) {
      console.warn(`[cotacao-moeda] AwesomeAPI falhou: ${err.message}`);
    }

    // 3) Se falhou online, pega o cache mais recente
    if (!cotacao) {
      const ultimo = await db.query(
        `SELECT cotacao, fonte, data FROM cotacoes_cache
         WHERE moeda=$1 ORDER BY data DESC LIMIT 1`,
        [moeda]
      );
      if (ultimo.rows.length > 0) {
        return res.json({
          moeda,
          data: ultimo.rows[0].data.toISOString().slice(0, 10),
          cotacao: Number(ultimo.rows[0].cotacao),
          fonte: ultimo.rows[0].fonte,
          cache: true,
          aviso: 'Cotação online indisponível — usando última cotação salva.'
        });
      }
      return res.status(503).json({
        error: 'Não foi possível obter cotação agora. Tente digitar manualmente.'
      });
    }

    // 4) Salva no cache
    try {
      await db.query(
        `INSERT INTO cotacoes_cache (moeda, data, cotacao, fonte)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (moeda, data) DO UPDATE SET cotacao=$3, fonte=$4, buscada_em=NOW()`,
        [moeda, hoje, cotacao, fonte]
      );
    } catch (e) {
      console.warn('[cotacao-moeda] falha no cache:', e.message);
    }

    res.json({ moeda, data: hoje, cotacao, fonte, cache: false });
  } catch (err) {
    console.error('[cotacao-moeda] erro:', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// POST /manual — Salvar cotação manual (dona digitou)
router.post('/manual', async (req, res) => {
  try {
    const { moeda, data, cotacao } = req.body || {};
    const m = String(moeda || '').toUpperCase();
    if (!MOEDAS_ACEITAS.includes(m)) return res.status(400).json({ error: 'Moeda inválida.' });
    const c = Number(cotacao);
    if (!(c > 0)) return res.status(400).json({ error: 'Cotação deve ser positiva.' });
    const d = data || new Date().toISOString().slice(0, 10);

    await db.query(
      `INSERT INTO cotacoes_cache (moeda, data, cotacao, fonte)
       VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (moeda, data) DO UPDATE SET cotacao=$3, fonte='manual', buscada_em=NOW()`,
      [m, d, c]
    );
    res.json({ ok: true, moeda: m, data: d, cotacao: c, fonte: 'manual' });
  } catch (err) {
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
