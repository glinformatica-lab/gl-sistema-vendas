// Rotas de Orçamentos
const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar orçamentos com filtros opcionais
router.get('/', async (req, res) => {
  const { status, q } = req.query;
  try {
    const params = [req.user.empresaId];
    let where = `WHERE o.empresa_id = $1`;
    // Vendedor vê APENAS seus orçamentos. Admin e estoque veem tudo.
    if (req.user.papel === 'vendedor') {
      params.push(req.user.userId);
      where += ` AND o.vendedor_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND o.status = $${params.length}`;
    }
    if (q) {
      params.push('%' + q + '%');
      where += ` AND (o.cliente_nome ILIKE $${params.length} OR CAST(o.numero AS TEXT) ILIKE $${params.length})`;
    }
    const r = await db.query(
      `SELECT o.*, c.nome AS cliente_nome_real,
              (SELECT COUNT(*) FROM lista_compras lc
               WHERE lc.orcamento_id = o.id AND lc.status IN ('pendente','pedido'))::int AS compras_abertas,
              (SELECT COUNT(*) FROM lista_compras lc
               WHERE lc.orcamento_id = o.id AND lc.status = 'pendente')::int AS compras_pendentes
       FROM orcamentos o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       ${where}
       ORDER BY o.numero DESC LIMIT 200`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[orcamentos] GET', err);
    res.status(500).json({ error: 'Erro ao listar orçamentos.' });
  }
});

// Buscar 1 orçamento com itens
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const rOrc = await db.query(
      `SELECT o.*, c.nome AS cliente_nome_real, c.telefone AS cliente_telefone,
              c.doc AS cliente_doc, c.endereco AS cliente_endereco,
              c.cidade AS cliente_cidade, c.uf AS cliente_uf
       FROM orcamentos o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE o.id = $1 AND o.empresa_id = $2 LIMIT 1`,
      [id, req.user.empresaId]
    );
    if (rOrc.rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado.' });
    const orcamento = rOrc.rows[0];
    // Vendedor só acessa seus próprios orçamentos
    if (req.user.papel === 'vendedor' && orcamento.vendedor_id && orcamento.vendedor_id !== req.user.userId) {
      return res.status(403).json({ error: 'Você não tem permissão para acessar este orçamento.' });
    }
    const rIt = await db.query(
      `SELECT * FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY ordem, id`,
      [id]
    );
    orcamento.itens = rIt.rows;
    res.json(orcamento);
  } catch (err) {
    console.error('[orcamentos] GET id', err);
    res.status(500).json({ error: 'Erro ao buscar orçamento.' });
  }
});

// Criar orçamento (cabeçalho + itens)
router.post('/', async (req, res) => {
  const {
    cliente_id, cliente_nome,
    validade_dias, observacoes, condicoes_pagamento,
    desconto, itens
  } = req.body || {};

  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Adicione pelo menos 1 item ao orçamento.' });
  }
  if (!cliente_nome || !cliente_nome.trim()) {
    return res.status(400).json({ error: 'Informe o cliente.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica se empresa usa ambientes — se não, ignora ambiente_id dos itens (defesa)
    const empRes = await client.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.user.empresaId]);
    const usaAmbientes = empRes.rows.length > 0 && empRes.rows[0].usa_ambientes;

    // Próximo número
    const rNum = await client.query(`SELECT proximo_numero_orcamento($1) AS num`, [req.user.empresaId]);
    const numero = rNum.rows[0].num;

    // Calcula totais a partir dos itens
    let subtotal = 0;
    for (const it of itens) {
      const qtd = parseFloat(it.quantidade) || 1;
      const vu = parseFloat(it.valor_unitario) || 0;
      const descIt = parseFloat(it.desconto_item) || 0;
      const totalItem = qtd * vu - descIt;
      it.total = totalItem;
      subtotal += totalItem;
    }
    const descontoNum = parseFloat(desconto) || 0;
    const total = Math.max(0, subtotal - descontoNum);
    const validadeDias = parseInt(validade_dias) || 7;
    const dataValidade = new Date();
    dataValidade.setDate(dataValidade.getDate() + validadeDias);
    const dataValidadeIso = dataValidade.toISOString().slice(0, 10);

    // Busca nome do vendedor
    const rUser = await client.query(`SELECT nome FROM usuarios WHERE id=$1`, [req.user.userId]);
    const vendedorNome = rUser.rows[0]?.nome || null;

    // Insere orçamento
    const rOrc = await client.query(
      `INSERT INTO orcamentos
       (empresa_id, numero, cliente_id, cliente_nome, validade_dias, data_validade,
        subtotal, desconto, total, observacoes, condicoes_pagamento,
        vendedor_id, vendedor_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.user.empresaId, numero, cliente_id || null, cliente_nome.trim(),
       validadeDias, dataValidadeIso,
       subtotal, descontoNum, total, observacoes || null, condicoes_pagamento || null,
       req.user.userId, vendedorNome]
    );
    const orcamento = rOrc.rows[0];

    // Insere itens
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      await client.query(
        `INSERT INTO orcamento_itens
         (orcamento_id, tipo, produto_id, servico_id, descricao, quantidade,
          valor_unitario, desconto_item, total, ordem, ambiente_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orcamento.id, it.tipo || 'avulso',
         it.produto_id || null, it.servico_id || null,
         it.descricao || '',
         parseFloat(it.quantidade) || 1,
         parseFloat(it.valor_unitario) || 0,
         parseFloat(it.desconto_item) || 0,
         it.total, i, (usaAmbientes && it.ambiente_id) ? parseInt(it.ambiente_id) : null]
      );
    }

    await client.query('COMMIT');
    res.json(orcamento);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orcamentos] POST', err);
    res.status(500).json({ error: 'Erro ao criar orçamento.' });
  } finally {
    client.release();
  }
});

// Atualizar orçamento (recria itens)
// Helper: verifica se vendedor pode editar orçamento (é dele) ou é admin/estoque
async function verificarDonoOrcamento(req, orcId) {
  if (req.user.papel !== 'vendedor') return { ok: true };
  const r = await db.query(
    'SELECT vendedor_id FROM orcamentos WHERE id = $1 AND empresa_id = $2',
    [orcId, req.user.empresaId]
  );
  if (r.rows.length === 0) return { ok: false, code: 404, msg: 'Orçamento não encontrado.' };
  if (r.rows[0].vendedor_id && r.rows[0].vendedor_id !== req.user.userId) {
    return { ok: false, code: 403, msg: 'Você não tem permissão para modificar este orçamento.' };
  }
  return { ok: true };
}

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const {
    cliente_id, cliente_nome,
    validade_dias, observacoes, condicoes_pagamento,
    desconto, itens
  } = req.body || {};

  // Verifica se o vendedor é dono do orçamento
  const verif = await verificarDonoOrcamento(req, id);
  if (!verif.ok) return res.status(verif.code).json({ error: verif.msg });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica se empresa usa ambientes — se não, ignora ambiente_id dos itens (defesa)
    const empRes = await client.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.user.empresaId]);
    const usaAmbientes = empRes.rows.length > 0 && empRes.rows[0].usa_ambientes;

    // Verifica se existe e não foi convertido
    const rExist = await client.query(
      `SELECT status FROM orcamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [id, req.user.empresaId]
    );
    if (rExist.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
    if (rExist.rows[0].status === 'convertido') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Orçamento já convertido em venda. Não pode ser editado.' });
    }

    // Recalcula totais
    let subtotal = 0;
    for (const it of (itens || [])) {
      const qtd = parseFloat(it.quantidade) || 1;
      const vu = parseFloat(it.valor_unitario) || 0;
      const descIt = parseFloat(it.desconto_item) || 0;
      it.total = qtd * vu - descIt;
      subtotal += it.total;
    }
    const descontoNum = parseFloat(desconto) || 0;
    const total = Math.max(0, subtotal - descontoNum);
    const validadeDias = parseInt(validade_dias) || 7;
    const dataValidade = new Date();
    dataValidade.setDate(dataValidade.getDate() + validadeDias);
    const dataValidadeIso = dataValidade.toISOString().slice(0, 10);

    await client.query(
      `UPDATE orcamentos SET
       cliente_id=$1, cliente_nome=$2, validade_dias=$3, data_validade=$4,
       subtotal=$5, desconto=$6, total=$7,
       observacoes=$8, condicoes_pagamento=$9, atualizado_em=NOW()
       WHERE id=$10`,
      [cliente_id || null, (cliente_nome || '').trim(), validadeDias, dataValidadeIso,
       subtotal, descontoNum, total,
       observacoes || null, condicoes_pagamento || null, id]
    );

    // Recria itens
    await client.query(`DELETE FROM orcamento_itens WHERE orcamento_id=$1`, [id]);
    for (let i = 0; i < (itens || []).length; i++) {
      const it = itens[i];
      await client.query(
        `INSERT INTO orcamento_itens
         (orcamento_id, tipo, produto_id, servico_id, descricao, quantidade,
          valor_unitario, desconto_item, total, ordem, ambiente_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, it.tipo || 'avulso',
         it.produto_id || null, it.servico_id || null,
         it.descricao || '',
         parseFloat(it.quantidade) || 1,
         parseFloat(it.valor_unitario) || 0,
         parseFloat(it.desconto_item) || 0,
         it.total, i, (usaAmbientes && it.ambiente_id) ? parseInt(it.ambiente_id) : null]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orcamentos] PUT', err);
    res.status(500).json({ error: 'Erro ao atualizar orçamento.' });
  } finally {
    client.release();
  }
});

// Mudar status (aprovar / cancelar)
router.post('/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body || {};
  const validos = ['aberto', 'aprovado', 'cancelado'];
  if (!validos.includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  // Verifica se o vendedor é dono do orçamento
  const verif = await verificarDonoOrcamento(req, id);
  if (!verif.ok) return res.status(verif.code).json({ error: verif.msg });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE orcamentos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND empresa_id=$3 AND status NOT IN ('convertido')
       RETURNING *`,
      [status, id, req.user.empresaId]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado ou já convertido.' });
    }
    const orcamento = r.rows[0];

    // Ao APROVAR: verifica se empresa usa iluminação e gera itens de compra pra produtos sem estoque
    let itensCriados = [];
    if (status === 'aprovado') {
      const empChk = await client.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.user.empresaId]);
      const usaAmbientes = empChk.rows[0]?.usa_ambientes;

      if (usaAmbientes) {
        // Busca itens do orçamento com produto vinculado
        const rItens = await client.query(
          `SELECT oi.produto_id, oi.quantidade,
                  p.nome, p.codigo, p.referencia, p.estoque
           FROM orcamento_itens oi
           JOIN produtos p ON p.id = oi.produto_id
           WHERE oi.orcamento_id = $1 AND oi.tipo = 'produto' AND oi.produto_id IS NOT NULL`,
          [id]
        );

        for (const item of rItens.rows) {
          const estoque = Number(item.estoque) || 0;
          const qtdOrc = Number(item.quantidade) || 0;
          const faltando = qtdOrc - estoque;

          if (faltando > 0) {
            // Verifica se já existe item na lista pra esse orçamento+produto (evita duplicata)
            const jaExiste = await client.query(
              `SELECT id FROM lista_compras
               WHERE empresa_id = $1 AND orcamento_id = $2 AND produto_id = $3`,
              [req.user.empresaId, id, item.produto_id]
            );
            if (jaExiste.rows.length === 0) {
              const ins = await client.query(
                `INSERT INTO lista_compras (empresa_id, orcamento_id, produto_id, produto_nome,
                                            produto_codigo, referencia, quantidade, status, criado_por)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', $8)
                 RETURNING id, produto_nome, quantidade`,
                [req.user.empresaId, id, item.produto_id, item.nome,
                 item.codigo, item.referencia, faltando, req.user.userId]
              );
              itensCriados.push({
                produto: ins.rows[0].produto_nome,
                quantidade: Number(ins.rows[0].quantidade)
              });
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    // Retorna orçamento + info dos itens criados (pra frontend mostrar alerta)
    res.json({
      ...orcamento,
      _listaComprasCriados: itensCriados
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orcamentos] status', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  } finally {
    client.release();
  }
});

// Marcar orçamento como convertido (quando a venda já foi criada via fluxo do modal)
router.post('/:id/marcar-convertido', async (req, res) => {
  const id = parseInt(req.params.id);
  const { venda_id } = req.body || {};
  try {
    const r = await db.query(
      `UPDATE orcamentos SET status='convertido', venda_id=$1, atualizado_em=NOW()
       WHERE id=$2 AND empresa_id=$3 AND status != 'convertido' RETURNING id`,
      [venda_id || null, id, req.user.empresaId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Orçamento não encontrado ou já convertido.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[orcamentos] marcar-convertido', err);
    res.status(500).json({ error: 'Erro ao marcar orçamento como convertido.' });
  }
});

// Converter em venda (modo automático - cria a venda direto - mantido pra compatibilidade)
router.post('/:id/converter', async (req, res) => {
  const id = parseInt(req.params.id);
  const { forma_pagamento } = req.body || {};
  if (!forma_pagamento) return res.status(400).json({ error: 'Informe a forma de pagamento.' });

  // Verifica se o vendedor é dono do orçamento
  const verif = await verificarDonoOrcamento(req, id);
  if (!verif.ok) return res.status(verif.code).json({ error: verif.msg });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Busca orçamento + itens
    const rOrc = await client.query(
      `SELECT * FROM orcamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [id, req.user.empresaId]
    );
    if (rOrc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
    const orc = rOrc.rows[0];
    if (orc.status === 'convertido') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Orçamento já foi convertido em venda.' });
    }

    const rItens = await client.query(
      `SELECT * FROM orcamento_itens WHERE orcamento_id=$1 ORDER BY ordem, id`,
      [id]
    );

    // Verifica estoque dos produtos
    for (const it of rItens.rows) {
      if (it.tipo === 'produto' && it.produto_id) {
        const rEst = await client.query(
          `SELECT estoque, nome FROM produtos WHERE id=$1 AND empresa_id=$2`,
          [it.produto_id, req.user.empresaId]
        );
        if (rEst.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Produto "${it.descricao}" não existe mais.` });
        }
        const est = parseFloat(rEst.rows[0].estoque) || 0;
        if (est < parseFloat(it.quantidade)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Estoque insuficiente para "${rEst.rows[0].nome}". Disponível: ${est}, necessário: ${it.quantidade}.`
          });
        }
      }
    }

    // Cria venda
    const rVenda = await client.query(
      `INSERT INTO vendas
       (empresa_id, cliente_id, vendedor_id, vendedor_nome,
        subtotal, desconto, total, forma_pagamento, observacoes, data_venda)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING id`,
      [req.user.empresaId, orc.cliente_id, orc.vendedor_id, orc.vendedor_nome,
       orc.subtotal, orc.desconto, orc.total, forma_pagamento,
       'Originado do Orçamento Nº ' + orc.numero + (orc.observacoes ? ' — ' + orc.observacoes : '')]
    );
    const vendaId = rVenda.rows[0].id;

    // Insere itens da venda (apenas produtos contam pra estoque)
    for (const it of rItens.rows) {
      // Insere item da venda
      await client.query(
        `INSERT INTO venda_itens
         (venda_id, produto_id, descricao, quantidade, valor_unitario, total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [vendaId, it.tipo === 'produto' ? it.produto_id : null,
         it.descricao, it.quantidade, it.valor_unitario, it.total]
      );
      // Baixa estoque se for produto
      if (it.tipo === 'produto' && it.produto_id) {
        await client.query(
          `UPDATE produtos SET estoque = estoque - $1 WHERE id=$2 AND empresa_id=$3`,
          [it.quantidade, it.produto_id, req.user.empresaId]
        );
      }
    }

    // Marca orçamento como convertido
    await client.query(
      `UPDATE orcamentos SET status='convertido', venda_id=$1, atualizado_em=NOW() WHERE id=$2`,
      [vendaId, id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, venda_id: vendaId, mensagem: 'Orçamento convertido em venda com sucesso!' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orcamentos] converter', err);
    res.status(500).json({ error: 'Erro ao converter em venda.' });
  } finally {
    client.release();
  }
});

// Excluir orçamento (só se não foi convertido)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    // Verifica se o vendedor é dono do orçamento
    const verif = await verificarDonoOrcamento(req, id);
    if (!verif.ok) return res.status(verif.code).json({ error: verif.msg });
    const r = await db.query(
      `DELETE FROM orcamentos WHERE id=$1 AND empresa_id=$2 AND status != 'convertido' RETURNING id`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ error: 'Orçamento não encontrado ou já convertido em venda.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[orcamentos] DELETE', err);
    res.status(500).json({ error: 'Erro ao excluir orçamento.' });
  }
});

module.exports = router;
