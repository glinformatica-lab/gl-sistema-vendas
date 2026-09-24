// ============================================
// ROTAS DO AGENT LOCAL (SQL Server no PC do cliente)
// Autenticação: header "x-agent-token" (NÃO usa JWT do usuário)
// Chamada apenas pelo agent Node.js instalado no PC do cliente.
// ============================================
const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: valida x-agent-token e injeta req.empresaId
async function validarAgent(req, res, next) {
  try {
    const token = req.headers['x-agent-token'];
    if (!token) return res.status(401).json({ error: 'Token do agent obrigatório (header x-agent-token).' });
    const r = await db.query(
      'SELECT empresa_id FROM hiper_config WHERE token_agent=$1 AND ativo=TRUE',
      [token]
    );
    if (r.rows.length === 0) return res.status(403).json({ error: 'Token do agent inválido ou inativo.' });
    req.empresaId = r.rows[0].empresa_id;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
}

// GET /ping — agent testa se está tudo ok e obtém a config
router.get('/ping', validarAgent, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT intervalo_sync_min, ativo, ultima_sync_clientes, ultima_sync_fornec
       FROM hiper_config WHERE empresa_id=$1`,
      [req.empresaId]
    );
    res.json({
      ok: true,
      empresaId: req.empresaId,
      config: r.rows[0] || {},
      servidor: {
        versao: '1.0.0',
        agora: new Date().toISOString()
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

// POST /upload — recebe dados do SQL local
// Body: { tipo: 'clientes'|'fornecedores', dados: [...] }
router.post('/upload', validarAgent, async (req, res) => {
  const inicio = Date.now();
  try {
    const { tipo, dados } = req.body || {};
    if (!['clientes', 'fornecedores'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido. Aceito: clientes | fornecedores' });
    }
    if (!Array.isArray(dados)) {
      return res.status(400).json({ error: 'dados deve ser array' });
    }

    // FASE 1: só loga. Upsert real virá quando você me mandar schema do SQL local Hiper.
    // Isso já valida a arquitetura ponta-a-ponta (agent → nuvem) sem risco de gravar
    // dado errado no banco antes de conhecer o formato real.
    await db.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, qtd_criados, duracao_ms, mensagem)
       VALUES ($1, $2, 'sql_local', 'ok', $3, $4, $5)`,
      [
        req.empresaId,
        tipo,
        dados.length,
        Date.now() - inicio,
        `Agent enviou ${dados.length} registros de ${tipo} (FASE 1: só log, upsert virá com schema)`
      ]
    );

    res.json({
      ok: true,
      recebidos: dados.length,
      mensagem: 'Dados recebidos. Upsert real será feito quando o schema do Hiper for mapeado (Fase 2).'
    });
  } catch (e) {
    await db.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, qtd_erros, duracao_ms, mensagem)
       VALUES ($1, $2, 'sql_local', 'erro', 1, $3, $4)`,
      [req.empresaId, req.body?.tipo || 'desconhecido', Date.now() - inicio, e.message]
    ).catch(() => {});
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

// POST /schema — agent envia o schema descoberto do SQL local
// Útil pra você descobrir os nomes das tabelas de clientes/fornecedores
router.post('/schema', validarAgent, async (req, res) => {
  try {
    const { tabelas } = req.body || {};
    if (!Array.isArray(tabelas)) {
      return res.status(400).json({ error: 'tabelas deve ser array' });
    }
    await db.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, mensagem)
       VALUES ($1, 'schema_discovery', 'sql_local', 'ok', $2)`,
      [req.empresaId, JSON.stringify(tabelas).slice(0, 4000)]
    );
    res.json({ ok: true, tabelasRecebidas: tabelas.length });
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
});

module.exports = router;
