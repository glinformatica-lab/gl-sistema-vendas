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

// POST /produtos-precos — Agent envia preços do Hiper (SQL local)
// Body: { produtos: [{ codigo: "5476", precoHiper: 130.50 }, ...] }
// Match: produtos.codigo = codigo do Hiper (mesma empresa)
// Só ATUALIZA o preco_hiper — nunca cria produto (produto é cadastrado no GL)
router.post('/produtos-precos', validarAgent, async (req, res) => {
  const inicio = Date.now();
  try {
    const { produtos } = req.body || {};
    if (!Array.isArray(produtos)) {
      return res.status(400).json({ error: 'Body inválido. Esperado: { produtos: [{codigo, precoHiper}] }' });
    }

    let atualizados = 0;
    let ignorados = 0;   // produto não existe no GL (não cadastrado ainda)
    let erros = 0;
    const naoEncontrados = [];

    for (const p of produtos) {
      try {
        const codigo = String(p.codigo || '').trim();
        const preco = Number(p.precoHiper);
        if (!codigo || !(preco >= 0)) { erros++; continue; }
        const r = await db.query(
          `UPDATE produtos
             SET preco_hiper = $1, preco_hiper_sync_em = NOW()
           WHERE empresa_id = $2 AND codigo = $3`,
          [preco, req.empresaId, codigo]
        );
        if (r.rowCount > 0) {
          atualizados++;
        } else {
          ignorados++;
          if (naoEncontrados.length < 20) naoEncontrados.push(codigo);
        }
      } catch (e) {
        erros++;
      }
    }

    await db.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, qtd_atualizados, qtd_erros, duracao_ms, mensagem)
       VALUES ($1, 'produtos_precos', 'sql_local', $2, $3, $4, $5, $6)`,
      [
        req.empresaId,
        erros === 0 ? 'ok' : 'parcial',
        atualizados, erros,
        Date.now() - inicio,
        `${produtos.length} recebidos, ${atualizados} atualizados, ${ignorados} ignorados (código não existe no GL), ${erros} erros`
        + (naoEncontrados.length > 0 ? ` · não encontrados: ${naoEncontrados.slice(0, 10).join(', ')}${naoEncontrados.length > 10 ? '...' : ''}` : '')
      ]
    );

    res.json({
      ok: true,
      recebidos: produtos.length,
      atualizados, ignorados, erros,
      naoEncontrados: naoEncontrados.slice(0, 10)
    });
  } catch (e) {
    console.error('[integra-hiper-agent] produtos-precos:', e);
    await db.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, qtd_erros, duracao_ms, mensagem)
       VALUES ($1, 'produtos_precos', 'sql_local', 'erro', 1, $2, $3)`,
      [req.empresaId, Date.now() - inicio, e.message]
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
