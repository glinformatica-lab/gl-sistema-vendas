// ============================================
// ORDENS DE COMPRA
// Comprador agrupa itens da Lista de Compras
// em ordens por fornecedor pra pedido único
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// autenticar e verificarAcesso já vêm do server.js
// Só precisamos validar módulo iluminação + papel estoque/admin

// Middleware: bloqueia se empresa não usa iluminação
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.usa_ambientes) {
      return res.status(403).json({ error: 'Recurso disponível apenas com Módulo Iluminação.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo.' });
  }
}

// Só admin/estoque acessam
function requerEstoque(req, res, next) {
  if (!['admin', 'estoque'].includes(req.user.papel)) {
    return res.status(403).json({ error: 'Apenas admin ou estoque pode acessar.' });
  }
  next();
}

router.use(requerAmbientes, requerEstoque);

// GET / — Lista ordens de compra
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT oc.*,
              f.nome AS fornecedor_nome_atual,
              (SELECT COUNT(*)::int FROM ordens_compra_itens oci WHERE oci.ordem_compra_id = oc.id) AS total_itens
       FROM ordens_compra oc
       LEFT JOIN fornecedores f ON f.id = oc.fornecedor_id
       WHERE oc.empresa_id = $1
       ORDER BY oc.numero DESC`,
      [req.user.empresaId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ordens-compra] GET', err);
    res.status(500).json({ error: 'Erro ao listar ordens.' });
  }
});

// GET /:id — Detalhes de uma ordem (com itens)
router.get('/:id', async (req, res) => {
  try {
    const rOc = await db.query(
      `SELECT oc.*, f.nome AS fornecedor_nome_atual,
              f.email AS fornecedor_email, f.telefone AS fornecedor_telefone,
              f.cnpj AS fornecedor_cnpj, f.endereco AS fornecedor_endereco,
              f.cidade AS fornecedor_cidade, f.uf AS fornecedor_uf
       FROM ordens_compra oc
       LEFT JOIN fornecedores f ON f.id = oc.fornecedor_id
       WHERE oc.id = $1 AND oc.empresa_id = $2`,
      [req.params.id, req.user.empresaId]
    );
    if (rOc.rows.length === 0) return res.status(404).json({ error: 'Ordem não encontrada.' });

    const rItens = await db.query(
      `SELECT * FROM ordens_compra_itens WHERE ordem_compra_id = $1 ORDER BY id`,
      [req.params.id]
    );
    res.json({ ordem: rOc.rows[0], itens: rItens.rows });
  } catch (err) {
    console.error('[ordens-compra] GET/:id', err);
    res.status(500).json({ error: 'Erro ao buscar ordem.' });
  }
});

// POST / — Cria nova ordem agrupando itens da lista_compras
// Body: {
//   listaComprasIds: [1, 5, 7...],  // IDs dos itens selecionados
//   fornecedorId: 3 | null,          // opcional
//   observacao: 'texto'
// }
router.post('/', async (req, res) => {
  const { listaComprasIds, fornecedorId, observacao } = req.body || {};

  if (!Array.isArray(listaComprasIds) || listaComprasIds.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos um item da Lista de Compras.' });
  }

  const idsInt = listaComprasIds.map(x => parseInt(x)).filter(x => Number.isInteger(x) && x > 0);
  if (idsInt.length === 0) {
    return res.status(400).json({ error: 'IDs inválidos.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Busca os itens da lista_compras selecionados (só pendentes e sem ordem vinculada)
    const rItens = await client.query(
      `SELECT lc.*, p.preco_custo
       FROM lista_compras lc
       LEFT JOIN produtos p ON p.id = lc.produto_id
       WHERE lc.id = ANY($1::int[])
         AND lc.empresa_id = $2
         AND lc.status = 'pendente'
         AND lc.ordem_compra_id IS NULL
       FOR UPDATE OF lc`,
      [idsInt, req.user.empresaId]
    );

    if (rItens.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Nenhum item disponível (verifique se estão pendentes e não em outra ordem).'
      });
    }

    // 2. Valida fornecedor se informado
    let fornecedorNome = null;
    if (fornecedorId) {
      const rForn = await client.query(
        'SELECT nome FROM fornecedores WHERE id=$1 AND empresa_id=$2',
        [fornecedorId, req.user.empresaId]
      );
      if (rForn.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Fornecedor não encontrado.' });
      }
      fornecedorNome = rForn.rows[0].nome;
    }

    // 3. Gera número sequencial da ordem
    const rNum = await client.query(
      'SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM ordens_compra WHERE empresa_id = $1',
      [req.user.empresaId]
    );
    const numero = rNum.rows[0].proximo;

    // 4. Pega nome do criador
    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const criadoPorNome = rUser.rows[0]?.nome || null;

    // 5. AGRUPA itens por produto (mesmo produto_id = soma quantidades)
    //    Se produto_id for null, agrupa por produto_nome (fallback)
    const grupos = new Map();
    for (const item of rItens.rows) {
      const chave = item.produto_id ? `p_${item.produto_id}` : `n_${item.produto_nome.toLowerCase()}`;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          produto_id: item.produto_id,
          produto_nome: item.produto_nome,
          produto_codigo: item.produto_codigo,
          referencia: item.referencia,
          quantidade: 0,
          preco_unitario: Number(item.preco_custo) || 0,
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

    // 6. Calcula valor estimado
    let valorEstimado = 0;
    for (const g of grupos.values()) {
      valorEstimado += g.quantidade * g.preco_unitario;
    }

    // 7. Cria ordem
    const rOc = await client.query(
      `INSERT INTO ordens_compra (empresa_id, numero, fornecedor_id, fornecedor_nome,
                                   status, criado_por, criado_por_nome, observacao, valor_estimado)
       VALUES ($1, $2, $3, $4, 'rascunho', $5, $6, $7, $8)
       RETURNING *`,
      [req.user.empresaId, numero, fornecedorId || null, fornecedorNome,
       req.user.userId, criadoPorNome, observacao || null, valorEstimado]
    );
    const ordem = rOc.rows[0];

    // 8. Cria itens agrupados + vincula lista_compras
    for (const g of grupos.values()) {
      await client.query(
        `INSERT INTO ordens_compra_itens
           (ordem_compra_id, produto_id, produto_nome, produto_codigo,
            referencia, quantidade, preco_unitario, origens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [ordem.id, g.produto_id, g.produto_nome, g.produto_codigo,
         g.referencia, g.quantidade, g.preco_unitario, JSON.stringify(g.origens)]
      );
      // Vincula os itens da lista_compras a essa ordem
      await client.query(
        `UPDATE lista_compras SET ordem_compra_id = $1 WHERE id = ANY($2::int[])`,
        [ordem.id, g.listaComprasIds]
      );
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      ordem,
      itensAgrupados: grupos.size,
      itensOrigem: rItens.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ordens-compra] POST', err);
    res.status(500).json({ error: 'Erro ao criar ordem: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /:id/enviada — Marca ordem como enviada + coloca itens da lista como 'pedido'
router.post('/:id/enviada', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rOc = await client.query(
      'SELECT * FROM ordens_compra WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [req.params.id, req.user.empresaId]
    );
    if (rOc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    const ordem = rOc.rows[0];
    if (ordem.status !== 'rascunho') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Ordem já está em status "${ordem.status}".` });
    }

    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const nomeUsr = rUser.rows[0]?.nome || null;

    // Marca ordem
    await client.query(
      `UPDATE ordens_compra
       SET status='enviada', data_envio=NOW(),
           enviada_por=$1, enviada_por_nome=$2
       WHERE id=$3`,
      [req.user.userId, nomeUsr, req.params.id]
    );

    // Marca itens da lista_compras como 'pedido'
    const rUpd = await client.query(
      `UPDATE lista_compras
       SET status='pedido', atualizado_por=$1, atualizado_por_nome=$2, atualizado_em=NOW()
       WHERE ordem_compra_id=$3 AND empresa_id=$4
       RETURNING id`,
      [req.user.userId, nomeUsr, req.params.id, req.user.empresaId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, itensPedidos: rUpd.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ordens-compra] enviada', err);
    res.status(500).json({ error: 'Erro ao marcar como enviada.' });
  } finally {
    client.release();
  }
});

// POST /:id/cancelar — Cancela ordem (desvincula itens, volta para pendente se estavam pedido)
router.post('/:id/cancelar', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rOc = await client.query(
      'SELECT * FROM ordens_compra WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [req.params.id, req.user.empresaId]
    );
    if (rOc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    const ordem = rOc.rows[0];
    if (['concluida', 'cancelada'].includes(ordem.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Ordem já está "${ordem.status}".` });
    }

    // Volta itens da lista_compras: pedido → pendente, e desvincula
    await client.query(
      `UPDATE lista_compras
       SET status = CASE WHEN status = 'pedido' THEN 'pendente' ELSE status END,
           ordem_compra_id = NULL,
           atualizado_em = NOW()
       WHERE ordem_compra_id = $1 AND empresa_id = $2 AND status != 'recebido'`,
      [req.params.id, req.user.empresaId]
    );

    await client.query(
      `UPDATE ordens_compra
       SET status='cancelada', data_cancelamento=NOW()
       WHERE id=$1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ordens-compra] cancelar', err);
    res.status(500).json({ error: 'Erro ao cancelar ordem.' });
  } finally {
    client.release();
  }
});

// DELETE /:id — Exclui ordem (só se rascunho — libera itens da lista)
router.delete('/:id', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rOc = await client.query(
      'SELECT status FROM ordens_compra WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [req.params.id, req.user.empresaId]
    );
    if (rOc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ordem não encontrada.' });
    }
    if (rOc.rows[0].status !== 'rascunho') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Só é possível excluir ordens em rascunho. Cancele em vez de excluir.' });
    }

    // Desvincula itens da lista_compras
    await client.query(
      `UPDATE lista_compras SET ordem_compra_id = NULL
       WHERE ordem_compra_id = $1 AND empresa_id = $2`,
      [req.params.id, req.user.empresaId]
    );

    // Exclui ordem (itens caem em CASCADE)
    await client.query('DELETE FROM ordens_compra WHERE id=$1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ordens-compra] DELETE', err);
    res.status(500).json({ error: 'Erro ao excluir ordem.' });
  } finally {
    client.release();
  }
});

module.exports = router;
