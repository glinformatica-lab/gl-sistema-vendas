const express = require('express');
const db = require('../db');
const router = express.Router();

const toNum = (v) => Number(v) || 0;
const camelizar = (obj) => {
  if (!obj) return obj;
  const r = {};
  for (const k in obj) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    r[camel] = obj[k];
  }
  return r;
};

// Middleware: verifica se empresa tem módulo iluminação ativo
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.user.empresaId]);
    if (r.rows.length === 0 || !r.rows[0].usa_ambientes) {
      return res.status(403).json({ error: 'Recurso não está ativo para sua empresa. Contate o suporte.' });
    }
    next();
  } catch (e) {
    console.error('[lista-compras/mw]', e);
    res.status(500).json({ error: 'Erro ao verificar permissão.' });
  }
}

// GET /api/lista-compras — Lista todos os itens
// Admin vê tudo. Vendedor vê só dos seus orçamentos.
router.get('/', requerAmbientes, async (req, res) => {
  try {
    const podeVerTudo = ['admin', 'estoque'].includes(req.user.papel);
    let query;
    let params;
    if (podeVerTudo) {
      query = `
        SELECT lc.*,
               o.numero AS orcamento_numero,
               o.cliente_nome AS cliente_nome,
               uc.nome AS criado_por_nome,
               ua.nome AS atualizado_por_nome
        FROM lista_compras lc
        LEFT JOIN orcamentos o ON o.id = lc.orcamento_id
        LEFT JOIN usuarios uc ON uc.id = lc.criado_por
        LEFT JOIN usuarios ua ON ua.id = lc.atualizado_por
        WHERE lc.empresa_id = $1
        ORDER BY
          CASE lc.status WHEN 'pendente' THEN 1 WHEN 'pedido' THEN 2 WHEN 'recebido' THEN 3 END,
          lc.criado_em DESC
      `;
      params = [req.user.empresaId];
    } else {
      // Vendedor: só vê itens de orçamentos que ele criou OU sem orçamento vinculado que ele criou
      query = `
        SELECT lc.*,
               o.numero AS orcamento_numero,
               o.cliente_nome AS cliente_nome,
               uc.nome AS criado_por_nome,
               ua.nome AS atualizado_por_nome
        FROM lista_compras lc
        LEFT JOIN orcamentos o ON o.id = lc.orcamento_id
        LEFT JOIN usuarios uc ON uc.id = lc.criado_por
        LEFT JOIN usuarios ua ON ua.id = lc.atualizado_por
        WHERE lc.empresa_id = $1
          AND (o.vendedor_id = $2 OR lc.criado_por = $2)
        ORDER BY
          CASE lc.status WHEN 'pendente' THEN 1 WHEN 'pedido' THEN 2 WHEN 'recebido' THEN 3 END,
          lc.criado_em DESC
      `;
      params = [req.user.empresaId, req.user.userId];
    }
    const r = await db.query(query, params);
    res.json(r.rows.map(row => ({
      ...camelizar(row),
      quantidade: toNum(row.quantidade)
    })));
  } catch (err) {
    console.error('[lista-compras/list]', err);
    res.status(500).json({ error: 'Erro ao listar itens.' });
  }
});

// GET /api/lista-compras/resumo — Contadores por status
router.get('/resumo', requerAmbientes, async (req, res) => {
  try {
    const podeVerTudo = ['admin', 'estoque'].includes(req.user.papel);
    let query;
    let params;
    if (podeVerTudo) {
      query = `
        SELECT lc.status,
               COUNT(*) AS qtd,
               COUNT(*) FILTER (WHERE lc.status = 'recebido' AND lc.recebido_em >= NOW() - INTERVAL '7 days') AS ultimos_7d
        FROM lista_compras lc
        WHERE lc.empresa_id = $1
        GROUP BY lc.status
      `;
      params = [req.user.empresaId];
    } else {
      query = `
        SELECT lc.status,
               COUNT(*) AS qtd,
               COUNT(*) FILTER (WHERE lc.status = 'recebido' AND lc.recebido_em >= NOW() - INTERVAL '7 days') AS ultimos_7d
        FROM lista_compras lc
        LEFT JOIN orcamentos o ON o.id = lc.orcamento_id
        WHERE lc.empresa_id = $1
          AND (o.vendedor_id = $2 OR lc.criado_por = $2)
        GROUP BY lc.status
      `;
      params = [req.user.empresaId, req.user.userId];
    }
    const r = await db.query(query, params);
    const resumo = { pendente: 0, pedido: 0, recebido: 0, recebidoUltimos7d: 0 };
    r.rows.forEach(row => {
      resumo[row.status] = parseInt(row.qtd, 10);
      if (row.status === 'recebido') resumo.recebidoUltimos7d = parseInt(row.ultimos_7d, 10);
    });
    res.json(resumo);
  } catch (err) {
    console.error('[lista-compras/resumo]', err);
    res.status(500).json({ error: 'Erro ao carregar resumo.' });
  }
});

// POST /api/lista-compras — Cria item avulso (uso manual)
router.post('/', requerAmbientes, async (req, res) => {
  const { produtoId, quantidade, orcamentoId, observacao } = req.body || {};
  if (!produtoId) return res.status(400).json({ error: 'Produto obrigatório.' });
  if (!quantidade || quantidade <= 0) return res.status(400).json({ error: 'Quantidade deve ser maior que zero.' });
  try {
    // Busca dados do produto pra cache
    const rProd = await db.query(
      'SELECT id, nome, codigo, referencia FROM produtos WHERE id = $1 AND empresa_id = $2',
      [produtoId, req.user.empresaId]
    );
    if (rProd.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    const p = rProd.rows[0];

    const ins = await db.query(
      `INSERT INTO lista_compras (empresa_id, orcamento_id, produto_id, produto_nome, produto_codigo, referencia,
                                   quantidade, status, observacao, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', $8, $9)
       RETURNING *`,
      [req.user.empresaId, orcamentoId || null, p.id, p.nome, p.codigo, p.referencia,
       quantidade, observacao || null, req.user.userId]
    );
    res.json({ ...camelizar(ins.rows[0]), quantidade: toNum(ins.rows[0].quantidade) });
  } catch (err) {
    console.error('[lista-compras/create]', err);
    res.status(500).json({ error: 'Erro ao criar item.' });
  }
});

// PATCH /api/lista-compras/:id/status — Muda status
router.patch('/:id/status', requerAmbientes, async (req, res) => {
  const { status, observacao } = req.body || {};
  const statusValidos = ['pendente', 'pedido', 'recebido'];
  if (!statusValidos.includes(status)) {
    return res.status(400).json({ error: 'Status inválido. Use: pendente, pedido ou recebido.' });
  }
  try {
    const camposExtra = status === 'recebido' ? ', recebido_em = NOW()' : '';
    const r = await db.query(
      `UPDATE lista_compras
       SET status = $1,
           observacao = COALESCE($2, observacao),
           atualizado_por = $3,
           atualizado_em = NOW()
           ${camposExtra}
       WHERE id = $4 AND empresa_id = $5
       RETURNING *`,
      [status, observacao || null, req.user.userId, req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ ok: true, item: { ...camelizar(r.rows[0]), quantidade: toNum(r.rows[0].quantidade) } });
  } catch (err) {
    console.error('[lista-compras/status]', err);
    res.status(500).json({ error: 'Erro ao atualizar status.' });
  }
});

// PATCH /api/lista-compras/:id/observacao — Só atualiza observação
router.patch('/:id/observacao', requerAmbientes, async (req, res) => {
  const { observacao } = req.body || {};
  try {
    const r = await db.query(
      `UPDATE lista_compras
       SET observacao = $1,
           atualizado_por = $2,
           atualizado_em = NOW()
       WHERE id = $3 AND empresa_id = $4
       RETURNING id`,
      [observacao || null, req.user.userId, req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[lista-compras/obs]', err);
    res.status(500).json({ error: 'Erro ao atualizar observação.' });
  }
});

// DELETE /api/lista-compras/:id — Remove item (só admin, ou o próprio vendedor que criou)
router.delete('/:id', requerAmbientes, async (req, res) => {
  try {
    const podeVerTudo = ['admin', 'estoque'].includes(req.user.papel);
    let query;
    let params;
    if (podeVerTudo) {
      query = 'DELETE FROM lista_compras WHERE id = $1 AND empresa_id = $2 RETURNING id';
      params = [req.params.id, req.user.empresaId];
    } else {
      query = 'DELETE FROM lista_compras WHERE id = $1 AND empresa_id = $2 AND criado_por = $3 RETURNING id';
      params = [req.params.id, req.user.empresaId, req.user.userId];
    }
    const r = await db.query(query, params);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Item não encontrado ou sem permissão.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[lista-compras/delete]', err);
    res.status(500).json({ error: 'Erro ao remover item.' });
  }
});

// GET /api/lista-compras/por-orcamento/:orcamentoId — itens de um orçamento específico
router.get('/por-orcamento/:orcamentoId', requerAmbientes, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT lc.*, ua.nome AS atualizado_por_nome
       FROM lista_compras lc
       LEFT JOIN usuarios ua ON ua.id = lc.atualizado_por
       WHERE lc.empresa_id = $1 AND lc.orcamento_id = $2
       ORDER BY lc.criado_em`,
      [req.user.empresaId, req.params.orcamentoId]
    );
    res.json(r.rows.map(row => ({
      ...camelizar(row),
      quantidade: toNum(row.quantidade)
    })));
  } catch (err) {
    console.error('[lista-compras/por-orcamento]', err);
    res.status(500).json({ error: 'Erro ao carregar itens do orçamento.' });
  }
});

// POST /api/lista-compras/excluir-lote — Exclui vários itens de uma vez (só admin)
// Body: { ids: [1, 5, 7, ...] }
router.post('/excluir-lote', requerAmbientes, async (req, res) => {
  if (req.user.papel !== 'admin') {
    return res.status(403).json({ error: 'Apenas admin pode excluir em lote.' });
  }
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Informe ao menos um ID.' });
  }
  // Sanitiza: converte para inteiros e filtra inválidos
  const idsInt = ids.map(x => parseInt(x)).filter(x => Number.isInteger(x) && x > 0);
  if (idsInt.length === 0) {
    return res.status(400).json({ error: 'IDs inválidos.' });
  }
  try {
    const r = await db.query(
      `DELETE FROM lista_compras
       WHERE id = ANY($1::int[]) AND empresa_id = $2
       RETURNING id, produto_nome, status`,
      [idsInt, req.user.empresaId]
    );
    res.json({
      ok: true,
      excluidos: r.rows.length,
      produtos: r.rows.map(x => x.produto_nome)
    });
  } catch (err) {
    console.error('[lista-compras/excluir-lote]', err);
    res.status(500).json({ error: 'Erro ao excluir em lote.' });
  }
});

module.exports = router;
