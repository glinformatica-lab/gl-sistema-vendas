// ============================================
// COTAÇÕES
// Fluxo: Lista Compras → Cotação (sem preços) → Fornecedores → Preços →
//        Comparar → Escolher vencedores → Ordens de Compra
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// Só empresas com módulo iluminação
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.usa_ambientes) {
      return res.status(403).json({ error: 'Cotações disponível apenas com Módulo Iluminação ativo.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo.' });
  }
}

// Só admin/estoque
function requerEstoque(req, res, next) {
  if (!['admin', 'estoque'].includes(req.user.papel)) {
    return res.status(403).json({ error: 'Apenas admin ou estoque pode acessar.' });
  }
  next();
}

router.use(requerAmbientes, requerEstoque);

// ==========================================
// GET / — Lista cotações
// ==========================================
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM cotacoes_itens ci WHERE ci.cotacao_id = c.id) AS total_itens,
              (SELECT COUNT(*)::int FROM cotacoes_fornecedores cf WHERE cf.cotacao_id = c.id) AS total_fornecedores,
              (SELECT COUNT(*)::int FROM cotacoes_fornecedores cf WHERE cf.cotacao_id = c.id AND cf.status = 'respondeu') AS total_respondeu
       FROM cotacoes c
       WHERE c.empresa_id = $1
       ORDER BY c.numero DESC`,
      [req.user.empresaId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[cotacoes] GET', err);
    res.status(500).json({ error: 'Erro ao listar cotações.' });
  }
});

// ==========================================
// GET /:id — Detalhes de uma cotação
// Retorna: cotacao + itens + fornecedores + respostas (grid completo)
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const rCot = await db.query(
      `SELECT * FROM cotacoes WHERE id=$1 AND empresa_id=$2`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) return res.status(404).json({ error: 'Cotação não encontrada.' });

    const rItens = await db.query(
      `SELECT * FROM cotacoes_itens WHERE cotacao_id=$1 ORDER BY id`,
      [req.params.id]
    );

    const rForn = await db.query(
      `SELECT cf.*, f.doc AS fornecedor_doc
       FROM cotacoes_fornecedores cf
       LEFT JOIN fornecedores f ON f.id = cf.fornecedor_id
       WHERE cf.cotacao_id=$1
       ORDER BY cf.id`,
      [req.params.id]
    );

    const rResp = await db.query(
      `SELECT * FROM cotacoes_respostas WHERE cotacao_id=$1`,
      [req.params.id]
    );

    res.json({
      cotacao: rCot.rows[0],
      itens: rItens.rows,
      fornecedores: rForn.rows,
      respostas: rResp.rows
    });
  } catch (err) {
    console.error('[cotacoes] GET/:id', err);
    res.status(500).json({ error: 'Erro ao buscar cotação: ' + err.message });
  }
});

// ==========================================
// GET /verificar-itens?listaComprasIds=1,2,3
// Verifica se os itens da lista já estão em outras cotações abertas
// (retorna avisos pra o modal de nova cotação)
// ==========================================
router.get('/verificar/itens', async (req, res) => {
  try {
    const idsStr = req.query.listaComprasIds || '';
    const ids = idsStr.split(',').map(x => parseInt(x)).filter(x => Number.isInteger(x) && x > 0);
    if (ids.length === 0) return res.json({ avisos: [] });

    // Busca itens da lista_compras que já têm cotacao_id vinculada a uma cotação NÃO fechada
    const r = await db.query(
      `SELECT lc.id AS lista_id, lc.produto_nome, c.id AS cotacao_id, c.numero AS cotacao_numero, c.status
       FROM lista_compras lc
       INNER JOIN cotacoes c ON c.id = lc.cotacao_id
       WHERE lc.id = ANY($1::int[])
         AND lc.empresa_id = $2
         AND c.status NOT IN ('fechada', 'cancelada')`,
      [ids, req.user.empresaId]
    );

    res.json({ avisos: r.rows });
  } catch (err) {
    console.error('[cotacoes] verificar', err);
    res.status(500).json({ error: 'Erro ao verificar itens.' });
  }
});

// ==========================================
// POST / — Cria nova cotação
// Body: {
//   listaComprasIds: [1, 5, 7...],        // itens vindos da lista de compras
//   itensAvulsos: [{ produtoId, quantidade, observacao? }],  // itens adicionados manualmente
//   fornecedoresIds: [3, 8, 12...],
//   observacao: '...',
//   prazoResposta: '2026-08-25' (opcional)
// }
// Pelo menos UM dos dois (listaComprasIds ou itensAvulsos) deve ter itens.
// ==========================================
router.post('/', async (req, res) => {
  const { listaComprasIds, itensAvulsos, fornecedoresIds, observacao, prazoResposta } = req.body || {};

  const listaOk = Array.isArray(listaComprasIds) && listaComprasIds.length > 0;
  const avulsosOk = Array.isArray(itensAvulsos) && itensAvulsos.length > 0;

  if (!listaOk && !avulsosOk) {
    return res.status(400).json({ error: 'Adicione ao menos um item (da lista de compras ou avulso).' });
  }
  if (!Array.isArray(fornecedoresIds) || fornecedoresIds.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um fornecedor pra cotar.' });
  }

  const idsInt = listaOk
    ? listaComprasIds.map(x => parseInt(x)).filter(x => Number.isInteger(x) && x > 0)
    : [];
  const fornIds = fornecedoresIds.map(x => parseInt(x)).filter(x => Number.isInteger(x) && x > 0);

  if (fornIds.length === 0) {
    return res.status(400).json({ error: 'IDs de fornecedores inválidos.' });
  }
  if (listaOk && idsInt.length === 0) {
    return res.status(400).json({ error: 'IDs da lista inválidos.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Busca itens da lista_compras (se houver)
    let rItens = { rows: [] };
    if (idsInt.length > 0) {
      rItens = await client.query(
        `SELECT lc.*, p.marca, p.marca_id
         FROM lista_compras lc
         LEFT JOIN produtos p ON p.id = lc.produto_id
         WHERE lc.id = ANY($1::int[])
           AND lc.empresa_id = $2
           AND lc.status = 'pendente'
         FOR UPDATE OF lc`,
        [idsInt, req.user.empresaId]
      );
    }

    // 1b. Busca produtos dos itens avulsos (valida que existem na empresa)
    let produtosAvulsos = [];
    if (avulsosOk) {
      const prodIds = itensAvulsos
        .map(it => parseInt(it.produtoId))
        .filter(x => Number.isInteger(x) && x > 0);
      if (prodIds.length > 0) {
        const rProd = await client.query(
          `SELECT id, nome, codigo, referencia, marca, marca_id
           FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2`,
          [prodIds, req.user.empresaId]
        );
        const mapProd = new Map(rProd.rows.map(p => [p.id, p]));
        for (const it of itensAvulsos) {
          const p = mapProd.get(parseInt(it.produtoId));
          const qtd = Number(it.quantidade);
          if (!p || !(qtd > 0)) continue;
          produtosAvulsos.push({
            produto: p,
            quantidade: qtd,
            observacao: it.observacao || null
          });
        }
      }
    }

    if (rItens.rows.length === 0 && produtosAvulsos.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nenhum item válido pra cotar.' });
    }

    // 2. Valida fornecedores
    const rForn = await client.query(
      `SELECT id, nome FROM fornecedores WHERE id = ANY($1::int[]) AND empresa_id = $2`,
      [fornIds, req.user.empresaId]
    );
    if (rForn.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nenhum fornecedor válido encontrado.' });
    }

    // 3. Número sequencial
    const rNum = await client.query(
      'SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM cotacoes WHERE empresa_id = $1',
      [req.user.empresaId]
    );
    const numero = rNum.rows[0].proximo;

    // 4. Nome do criador
    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const criadoPorNome = rUser.rows[0]?.nome || null;

    // 5. Cria cotação
    const rCot = await client.query(
      `INSERT INTO cotacoes (empresa_id, numero, observacao, prazo_resposta, criado_por, criado_por_nome)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.empresaId, numero, observacao || null, prazoResposta || null,
       req.user.userId, criadoPorNome]
    );
    const cotacao = rCot.rows[0];

    // 6. Agrupa itens (mesmo produto = soma qtds). Combina lista_compras + avulsos.
    const grupos = new Map();

    // Itens da lista de compras
    for (const item of rItens.rows) {
      const chave = item.produto_id ? `p_${item.produto_id}` : `n_${item.produto_nome.toLowerCase()}`;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          produto_codigo: item.produto_codigo,
          referencia: item.referencia,
          marca: item.marca,
          quantidade: 0,
          origens: [],
          listaComprasIds: []
        });
      }
      const g = grupos.get(chave);
      g.quantidade += Number(item.quantidade);
      g.origens.push({
        orcamento_id: item.orcamento_id,
        lista_compras_id: item.id,
        quantidade: Number(item.quantidade)
      });
      g.listaComprasIds.push(item.id);
    }

    // Itens avulsos (adicionados manualmente na cotação)
    for (const av of produtosAvulsos) {
      const p = av.produto;
      const chave = `p_${p.id}`;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          produto_id: p.id,
          produto_nome: p.nome,
          produto_codigo: p.codigo,
          referencia: p.referencia,
          marca: p.marca,
          quantidade: 0,
          origens: [],
          listaComprasIds: []
        });
      }
      const g = grupos.get(chave);
      g.quantidade += av.quantidade;
      g.origens.push({ avulso: true, quantidade: av.quantidade });
    }

    // 7. Cria itens agrupados + vincula lista_compras (se houver)
    for (const g of grupos.values()) {
      await client.query(
        `INSERT INTO cotacoes_itens
           (cotacao_id, produto_id, produto_nome, produto_codigo, referencia, marca, quantidade, origens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [cotacao.id, g.produto_id, g.produto_nome, g.produto_codigo,
         g.referencia, g.marca, g.quantidade, JSON.stringify(g.origens)]
      );
      if (g.listaComprasIds.length > 0) {
        await client.query(
          `UPDATE lista_compras SET cotacao_id = $1 WHERE id = ANY($2::int[])`,
          [cotacao.id, g.listaComprasIds]
        );
      }
    }

    // 8. Cria fornecedores vinculados
    for (const forn of rForn.rows) {
      await client.query(
        `INSERT INTO cotacoes_fornecedores
           (cotacao_id, fornecedor_id, fornecedor_nome, status)
         VALUES ($1, $2, $3, 'aguardando')`,
        [cotacao.id, forn.id, forn.nome]
      );
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      cotacao,
      itensAgrupados: grupos.size,
      itensDaLista: rItens.rows.length,
      itensAvulsos: produtosAvulsos.length,
      fornecedores: rForn.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] POST', err);
    res.status(500).json({ error: 'Erro ao criar cotação: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/responder/:fornecedorId
// Salva os preços que um fornecedor respondeu
// Body: {
//   respostas: [{ cotacao_item_id: 5, preco_unitario: 12.50, observacao }, ...],
//   prazoEntregaDias: 7,
//   condicaoPagamento: '30/60',
//   observacao: 'texto'
// }
// ==========================================
router.post('/:id/responder/:cotFornId', async (req, res) => {
  const { respostas, prazoEntregaDias, condicaoPagamento, observacao } = req.body || {};

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Valida cotação
    const rCot = await client.query(
      `SELECT * FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    const cotacao = rCot.rows[0];
    if (['fechada', 'cancelada'].includes(cotacao.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação já está "${cotacao.status}".` });
    }

    // Valida fornecedor da cotação
    const rCF = await client.query(
      `SELECT * FROM cotacoes_fornecedores
       WHERE id=$1 AND cotacao_id=$2 FOR UPDATE`,
      [req.params.cotFornId, req.params.id]
    );
    if (rCF.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fornecedor não vinculado à esta cotação.' });
    }

    // Upsert das respostas (item por item)
    if (Array.isArray(respostas)) {
      for (const r of respostas) {
        const itemId = parseInt(r.cotacao_item_id);
        const preco = r.preco_unitario != null && r.preco_unitario !== ''
          ? Number(r.preco_unitario) : null;
        const obs = r.observacao || null;

        if (!Number.isInteger(itemId) || itemId <= 0) continue;

        // Valida que o item pertence a esta cotação (segurança)
        const rItemChk = await client.query(
          `SELECT id FROM cotacoes_itens WHERE id=$1 AND cotacao_id=$2`,
          [itemId, req.params.id]
        );
        if (rItemChk.rows.length === 0) continue;

        await client.query(
          `INSERT INTO cotacoes_respostas
             (cotacao_id, cotacao_item_id, cotacao_fornecedor_id, preco_unitario, observacao)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (cotacao_item_id, cotacao_fornecedor_id)
           DO UPDATE SET preco_unitario = EXCLUDED.preco_unitario,
                         observacao = EXCLUDED.observacao`,
          [req.params.id, itemId, req.params.cotFornId, preco, obs]
        );
      }
    }

    // Atualiza status do fornecedor + condições
    await client.query(
      `UPDATE cotacoes_fornecedores SET
         status = 'respondeu',
         prazo_entrega_dias = $1,
         condicao_pagamento = $2,
         observacao = $3,
         respondeu_em = NOW()
       WHERE id = $4`,
      [
        Number.isInteger(parseInt(prazoEntregaDias)) ? parseInt(prazoEntregaDias) : null,
        condicaoPagamento || null,
        observacao || null,
        req.params.cotFornId
      ]
    );

    // Atualiza status da cotação: se algum respondeu, vira 'recebendo'
    if (cotacao.status === 'aberta') {
      await client.query(
        `UPDATE cotacoes SET status = 'recebendo' WHERE id = $1`,
        [req.params.id]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] responder', err);
    res.status(500).json({ error: 'Erro ao salvar resposta: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/fechar
// Converte cotação em ordens de compra (splitting: 1 ordem por fornecedor vencedor)
// Body: {
//   vencedores: [
//     { cotacao_item_id: 5, cotacao_fornecedor_id: 3 },
//     { cotacao_item_id: 6, cotacao_fornecedor_id: 3 },
//     { cotacao_item_id: 7, cotacao_fornecedor_id: 8 },  // outro fornecedor
//   ]
// }
// ==========================================
router.post('/:id/fechar', async (req, res) => {
  const { vencedores } = req.body || {};
  if (!Array.isArray(vencedores) || vencedores.length === 0) {
    return res.status(400).json({ error: 'Escolha pelo menos um vencedor por item.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rCot = await client.query(
      `SELECT * FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    const cotacao = rCot.rows[0];
    if (['fechada', 'cancelada'].includes(cotacao.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação já está "${cotacao.status}".` });
    }

    // Busca itens + fornecedores da cotação
    const rItens = await client.query(
      `SELECT * FROM cotacoes_itens WHERE cotacao_id=$1`,
      [req.params.id]
    );
    const rForn = await client.query(
      `SELECT * FROM cotacoes_fornecedores WHERE cotacao_id=$1`,
      [req.params.id]
    );

    const mapItens = new Map(rItens.rows.map(i => [i.id, i]));
    const mapForn = new Map(rForn.rows.map(f => [f.id, f]));

    // Agrupa vencedores por fornecedor
    const vencedoresPorForn = new Map();
    for (const v of vencedores) {
      const itemId = parseInt(v.cotacao_item_id);
      const fornId = parseInt(v.cotacao_fornecedor_id);
      if (!mapItens.has(itemId) || !mapForn.has(fornId)) continue;

      if (!vencedoresPorForn.has(fornId)) {
        vencedoresPorForn.set(fornId, []);
      }
      vencedoresPorForn.get(fornId).push(itemId);
    }

    if (vencedoresPorForn.size === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Nenhum vencedor válido.' });
    }

    // Nome do usuário
    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const nomeUsr = rUser.rows[0]?.nome || null;

    // Marca respostas vencedoras (limpa antigas e marca novas)
    await client.query(
      `UPDATE cotacoes_respostas SET vencedor = FALSE WHERE cotacao_id = $1`,
      [req.params.id]
    );
    for (const [fornId, itemIds] of vencedoresPorForn.entries()) {
      await client.query(
        `UPDATE cotacoes_respostas SET vencedor = TRUE
         WHERE cotacao_id = $1 AND cotacao_fornecedor_id = $2 AND cotacao_item_id = ANY($3::int[])`,
        [req.params.id, fornId, itemIds]
      );
    }

    // Cria UMA ordem de compra por fornecedor
    const ordensGeradas = [];

    for (const [cotFornId, itemIds] of vencedoresPorForn.entries()) {
      const forn = mapForn.get(cotFornId);

      // Próximo número da ordem
      const rNumOc = await client.query(
        'SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM ordens_compra WHERE empresa_id = $1',
        [req.user.empresaId]
      );
      const numeroOc = rNumOc.rows[0].proximo;

      // Cria ordem
      const rOc = await client.query(
        `INSERT INTO ordens_compra
           (empresa_id, numero, fornecedor_id, fornecedor_nome, status,
            criado_por, criado_por_nome, observacao, cotacao_id, valor_estimado)
         VALUES ($1, $2, $3, $4, 'rascunho', $5, $6, $7, $8, 0)
         RETURNING *`,
        [req.user.empresaId, numeroOc, forn.fornecedor_id, forn.fornecedor_nome,
         req.user.userId, nomeUsr,
         `Gerada da Cotação #${String(cotacao.numero).padStart(3, '0')}${forn.condicao_pagamento ? ' · Pgto: ' + forn.condicao_pagamento : ''}${forn.prazo_entrega_dias ? ' · Entrega em ' + forn.prazo_entrega_dias + ' dias' : ''}`,
         req.params.id]
      );
      const ordem = rOc.rows[0];

      // Busca preços das respostas vencedoras
      const rResp = await client.query(
        `SELECT r.*, ci.produto_id, ci.produto_nome, ci.produto_codigo,
                ci.referencia, ci.quantidade, ci.origens
         FROM cotacoes_respostas r
         INNER JOIN cotacoes_itens ci ON ci.id = r.cotacao_item_id
         WHERE r.cotacao_id = $1
           AND r.cotacao_fornecedor_id = $2
           AND r.cotacao_item_id = ANY($3::int[])`,
        [req.params.id, cotFornId, itemIds]
      );

      let valorTotal = 0;
      for (const item of rResp.rows) {
        const preco = Number(item.preco_unitario) || 0;
        const subtotal = Number(item.quantidade) * preco;
        valorTotal += subtotal;

        await client.query(
          `INSERT INTO ordens_compra_itens
             (ordem_compra_id, produto_id, produto_nome, produto_codigo,
              referencia, quantidade, preco_unitario, origens)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [ordem.id, item.produto_id, item.produto_nome, item.produto_codigo,
           item.referencia, item.quantidade, preco,
           JSON.stringify(item.origens || [])]
        );

        // Vincula lista_compras a esta ordem (usando origens)
        const origens = Array.isArray(item.origens) ? item.origens : [];
        const listaIds = origens.map(o => o.lista_compras_id).filter(Boolean);
        if (listaIds.length > 0) {
          await client.query(
            `UPDATE lista_compras SET ordem_compra_id = $1 WHERE id = ANY($2::int[])`,
            [ordem.id, listaIds]
          );
        }
      }

      // Atualiza valor estimado da ordem
      await client.query(
        `UPDATE ordens_compra SET valor_estimado = $1 WHERE id = $2`,
        [valorTotal, ordem.id]
      );

      ordensGeradas.push({
        id: ordem.id,
        numero: ordem.numero,
        fornecedor: forn.fornecedor_nome,
        itens: itemIds.length,
        valor: valorTotal
      });
    }

    // Fecha cotação
    await client.query(
      `UPDATE cotacoes SET status = 'fechada', data_fechamento = NOW(),
                            fechado_por = $1, fechado_por_nome = $2
       WHERE id = $3`,
      [req.user.userId, nomeUsr, req.params.id]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      ordens: ordensGeradas,
      cotacao: cotacao.numero
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] fechar', err);
    res.status(500).json({ error: 'Erro ao fechar cotação: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/cancelar
// ==========================================
router.post('/:id/cancelar', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT * FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação já está "${rCot.rows[0].status}".` });
    }

    // Desvincula lista_compras
    await client.query(
      `UPDATE lista_compras SET cotacao_id = NULL
       WHERE cotacao_id = $1 AND empresa_id = $2`,
      [req.params.id, req.user.empresaId]
    );

    await client.query(
      `UPDATE cotacoes SET status = 'cancelada', data_cancelamento = NOW() WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] cancelar', err);
    res.status(500).json({ error: 'Erro ao cancelar.' });
  } finally {
    client.release();
  }
});

// ==========================================
// PUT /:id — Atualiza dados básicos da cotação (observação, prazo)
// Body: { observacao, prazoResposta }
// ==========================================
router.put('/:id', async (req, res) => {
  const { observacao, prazoResposta } = req.body || {};
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT status FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação já está "${rCot.rows[0].status}" e não pode ser editada.` });
    }

    await client.query(
      `UPDATE cotacoes SET observacao=$1, prazo_resposta=$2 WHERE id=$3`,
      [observacao || null, prazoResposta || null, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] PUT', err);
    res.status(500).json({ error: 'Erro ao atualizar cotação.' });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/itens — Adiciona item na cotação
// Body: { produtoId, quantidade }
// ==========================================
router.post('/:id/itens', async (req, res) => {
  const { produtoId, quantidade } = req.body || {};
  const qtd = Number(quantidade);
  const prodId = parseInt(produtoId);

  if (!Number.isInteger(prodId) || prodId <= 0) {
    return res.status(400).json({ error: 'produtoId inválido.' });
  }
  if (!(qtd > 0)) {
    return res.status(400).json({ error: 'Quantidade inválida.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT status FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação "${rCot.rows[0].status}" não pode receber novos itens.` });
    }

    // Busca produto
    const rProd = await client.query(
      `SELECT id, nome, codigo, referencia, marca FROM produtos
       WHERE id=$1 AND empresa_id=$2`,
      [prodId, req.user.empresaId]
    );
    if (rProd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }
    const p = rProd.rows[0];

    // Se produto já está na cotação: soma quantidade
    const rExist = await client.query(
      `SELECT id, quantidade FROM cotacoes_itens
       WHERE cotacao_id=$1 AND produto_id=$2 FOR UPDATE`,
      [req.params.id, p.id]
    );
    if (rExist.rows.length > 0) {
      const novaQtd = Number(rExist.rows[0].quantidade) + qtd;
      await client.query(
        `UPDATE cotacoes_itens SET quantidade=$1 WHERE id=$2`,
        [novaQtd, rExist.rows[0].id]
      );
      // Desmarcar respostas deste item (quantidade mudou)
      await client.query(
        `DELETE FROM cotacoes_respostas
         WHERE cotacao_item_id=$1 AND cotacao_id=$2`,
        [rExist.rows[0].id, req.params.id]
      );
    } else {
      await client.query(
        `INSERT INTO cotacoes_itens
           (cotacao_id, produto_id, produto_nome, produto_codigo, referencia, marca, quantidade, origens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '[{"avulso":true,"origem":"edicao"}]'::jsonb)`,
        [req.params.id, p.id, p.nome, p.codigo, p.referencia, p.marca, qtd]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] POST itens', err);
    res.status(500).json({ error: 'Erro ao adicionar item: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// PUT /:id/itens/:itemId — Altera quantidade do item
// Body: { quantidade }
// Se mudar quantidade → desmarca respostas (preço precisa ser reavaliado)
// ==========================================
router.put('/:id/itens/:itemId', async (req, res) => {
  const qtd = Number(req.body?.quantidade);
  if (!(qtd > 0)) return res.status(400).json({ error: 'Quantidade inválida.' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT status FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação "${rCot.rows[0].status}" não pode ser editada.` });
    }

    const rItem = await client.query(
      `SELECT id, quantidade FROM cotacoes_itens WHERE id=$1 AND cotacao_id=$2 FOR UPDATE`,
      [req.params.itemId, req.params.id]
    );
    if (rItem.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    const qtdAtual = Number(rItem.rows[0].quantidade);
    let respostasDesmarcadas = 0;
    if (qtdAtual !== qtd) {
      // Muda qtd → desmarca respostas do item
      const rDel = await client.query(
        `DELETE FROM cotacoes_respostas WHERE cotacao_item_id=$1 AND cotacao_id=$2`,
        [req.params.itemId, req.params.id]
      );
      respostasDesmarcadas = rDel.rowCount;

      await client.query(
        `UPDATE cotacoes_itens SET quantidade=$1 WHERE id=$2`,
        [qtd, req.params.itemId]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, respostasDesmarcadas });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] PUT itens', err);
    res.status(500).json({ error: 'Erro ao atualizar item: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// DELETE /:id/itens/:itemId — Remove item + suas respostas
// ==========================================
router.delete('/:id/itens/:itemId', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT status FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação "${rCot.rows[0].status}" não pode ser editada.` });
    }

    // Verifica que o item pertence à cotação e desvincula lista_compras
    const rItem = await client.query(
      `SELECT id, origens FROM cotacoes_itens WHERE id=$1 AND cotacao_id=$2`,
      [req.params.itemId, req.params.id]
    );
    if (rItem.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    // Desvincula da lista_compras (se veio de lá)
    const origens = Array.isArray(rItem.rows[0].origens) ? rItem.rows[0].origens : [];
    const listaIds = origens.map(o => o.lista_compras_id).filter(Boolean);
    if (listaIds.length > 0) {
      await client.query(
        `UPDATE lista_compras SET cotacao_id = NULL
         WHERE id = ANY($1::int[]) AND empresa_id = $2`,
        [listaIds, req.user.empresaId]
      );
    }

    // Deleta item (respostas caem em cascade)
    await client.query(`DELETE FROM cotacoes_itens WHERE id=$1`, [req.params.itemId]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] DELETE itens', err);
    res.status(500).json({ error: 'Erro ao remover item.' });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/fornecedores — Adiciona novo fornecedor à cotação
// Body: { fornecedorId }
// ==========================================
router.post('/:id/fornecedores', async (req, res) => {
  const fornId = parseInt(req.body?.fornecedorId);
  if (!Number.isInteger(fornId) || fornId <= 0) {
    return res.status(400).json({ error: 'fornecedorId inválido.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT status FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação "${rCot.rows[0].status}" não pode ser editada.` });
    }

    const rForn = await client.query(
      `SELECT id, nome FROM fornecedores WHERE id=$1 AND empresa_id=$2`,
      [fornId, req.user.empresaId]
    );
    if (rForn.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    }

    try {
      await client.query(
        `INSERT INTO cotacoes_fornecedores
           (cotacao_id, fornecedor_id, fornecedor_nome, status)
         VALUES ($1, $2, $3, 'aguardando')`,
        [req.params.id, rForn.rows[0].id, rForn.rows[0].nome]
      );
    } catch (e) {
      if (e.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Fornecedor já está na cotação.' });
      }
      throw e;
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] POST fornecedor', err);
    res.status(500).json({ error: 'Erro ao adicionar fornecedor: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// DELETE /:id/fornecedores/:cotFornId — Remove fornecedor da cotação
// (respostas dele caem em cascade)
// ==========================================
router.delete('/:id/fornecedores/:cotFornId', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rCot = await client.query(
      `SELECT status FROM cotacoes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rCot.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotação não encontrada.' });
    }
    if (['fechada', 'cancelada'].includes(rCot.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cotação "${rCot.rows[0].status}" não pode ser editada.` });
    }

    // Impede deletar o último fornecedor
    const rCount = await client.query(
      `SELECT COUNT(*)::int AS total FROM cotacoes_fornecedores WHERE cotacao_id=$1`,
      [req.params.id]
    );
    if (rCount.rows[0].total <= 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cotação precisa ter pelo menos 1 fornecedor.' });
    }

    const rDel = await client.query(
      `DELETE FROM cotacoes_fornecedores
       WHERE id=$1 AND cotacao_id=$2 RETURNING id`,
      [req.params.cotFornId, req.params.id]
    );
    if (rDel.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fornecedor não vinculado a esta cotação.' });
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cotacoes] DELETE fornecedor', err);
    res.status(500).json({ error: 'Erro ao remover fornecedor.' });
  } finally {
    client.release();
  }
});

module.exports = router;
