// ============================================
// ROTAS DO MÓDULO INTEGRA HIPER
// Config + sync manual + logs + endpoint pro agent local enviar dados
// ============================================
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const hiperClient = require('../services/hiper-client');
const hiperSync = require('../services/hiper-sync');

// Middleware: bloqueia se módulo não estiver ativo pra empresa
async function requerIntegraHiper(req, res, next) {
  try {
    const r = await db.query(
      'SELECT modulo_integra_hiper FROM empresas WHERE id=$1',
      [req.user.empresaId]
    );
    if (!r.rows[0]?.modulo_integra_hiper) {
      return res.status(403).json({ error: 'Módulo INTEGRA HIPER não está ativo. Contate o suporte.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo.' });
  }
}

// GET /config — retorna configuração atual (SEM expor chave completa)
router.get('/config', requerIntegraHiper, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, empresa_id, intervalo_sync_min, ativo,
              ultima_sync_produtos, ultima_sync_estoque,
              ultima_sync_clientes, ultima_sync_fornec,
              ponto_sync_produtos,
              (chave_api IS NOT NULL AND LENGTH(chave_api) > 0) AS tem_chave,
              (token_agent IS NOT NULL) AS tem_agent
       FROM hiper_config WHERE empresa_id=$1`,
      [req.user.empresaId]
    );
    if (r.rows.length === 0) {
      return res.json({ configurado: false });
    }
    res.json({ configurado: true, ...r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

// POST /config — salva configuração (chave API + intervalo)
router.post('/config', requerIntegraHiper, async (req, res) => {
  try {
    const { chaveApi, intervaloSyncMin } = req.body || {};
    const intervalo = [5, 15, 30, 60].includes(Number(intervaloSyncMin)) ? Number(intervaloSyncMin) : 15;

    // Testa a chave antes de salvar
    if (chaveApi) {
      const teste = await hiperClient.testarCredenciais(chaveApi);
      if (!teste.ok) {
        return res.status(400).json({ error: 'Chave inválida: ' + teste.mensagem });
      }
    }

    // Gera token do agent (usado quando agent local mandar dados)
    const tokenAgent = crypto.randomBytes(32).toString('hex');

    await db.query(
      `INSERT INTO hiper_config (empresa_id, chave_api, token_agent, intervalo_sync_min)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (empresa_id) DO UPDATE
         SET chave_api = COALESCE(EXCLUDED.chave_api, hiper_config.chave_api),
             intervalo_sync_min = EXCLUDED.intervalo_sync_min`,
      [req.user.empresaId, chaveApi || null, tokenAgent, intervalo]
    );
    res.json({ ok: true, mensagem: 'Configuração salva!' });
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

// GET /token-agent — retorna o token único que o agent local usa
// (só admin da empresa vê; nunca aparece na tela normal)
router.get('/token-agent', requerIntegraHiper, async (req, res) => {
  try {
    if (req.user.papel !== 'admin' && req.user.papel !== 'master') {
      return res.status(403).json({ error: 'Apenas admin pode ver o token do agent.' });
    }
    const r = await db.query(
      'SELECT token_agent FROM hiper_config WHERE empresa_id=$1',
      [req.user.empresaId]
    );
    res.json({ token: r.rows[0]?.token_agent || null });
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

// POST /sync-manual — dispara sync agora (produtos da API Hiper)
router.post('/sync-manual', requerIntegraHiper, async (req, res) => {
  try {
    const resultado = await hiperSync.syncProdutos(req.user.empresaId);
    res.json({ ok: true, ...resultado });
  } catch (e) {
    res.status(500).json({ error: 'Erro na sync: ' + e.message });
  }
});

// GET /logs — últimos 30 logs de sync
router.get('/logs', requerIntegraHiper, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, tipo, fonte, status, qtd_criados, qtd_atualizados, qtd_erros,
              duracao_ms, mensagem, executado_em
       FROM hiper_log_sync
       WHERE empresa_id=$1
       ORDER BY executado_em DESC LIMIT 30`,
      [req.user.empresaId]
    );
    res.json({ logs: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

// POST /testar-credenciais — testa se a chave é válida (usa antes de salvar)
router.post('/testar-credenciais', requerIntegraHiper, async (req, res) => {
  try {
    const { chaveApi } = req.body || {};
    if (!chaveApi) return res.status(400).json({ error: 'Chave obrigatória.' });
    const teste = await hiperClient.testarCredenciais(chaveApi);
    res.json(teste);
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

module.exports = router;
