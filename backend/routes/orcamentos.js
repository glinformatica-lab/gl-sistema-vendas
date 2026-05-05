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
    if (status) {
      params.push(status);
      where += ` AND o.status = $${params.length}`;
    }
    if (q) {
      params.push('%' + q + '%');
      where += ` AND (o.cliente_nome ILIKE $${params.length} OR CAST(o.numero AS TEXT) ILIKE $${params.length})`;
    }
    const r = await db.query(
      `SELECT o.*, c.nome AS cliente_nome_real
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
      `SELECT o.*, c.nome AS cliente_nome_real, c.telefone AS cliente_telefone, c.email AS cliente_email,
              c.cpf_cnpj AS cliente_cpf_cnpj, c.endereco AS cliente_endereco
       FROM orcamentos o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE o.id = $1 AND o.empresa_id = $2 LIMIT 1`,
      [id, req.user.empresaId]
    );
    if (rOrc.rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado.' });
    const orcamento = rOrc.rows[0];
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
          valor_unitario, desconto_item, total, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orcamento.id, it.tipo || 'avulso',
         it.produto_id || null, it.servico_id || null,
         it.descricao || '',
         parseFloat(it.quantidade) || 1,
         parseFloat(it.valor_unitario) || 0,
         parseFloat(it.desconto_item) || 0,
         it.total, i]
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
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const {
    cliente_id, cliente_nome,
    validade_dias, observacoes, condicoes_pagamento,
    desconto, itens
  } = req.body || {};

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

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
          valor_unitario, desconto_item, total, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, it.tipo || 'avulso',
         it.produto_id || null, it.servico_id || null,
         it.descricao || '',
         parseFloat(it.quantidade) || 1,
         parseFloat(it.valor_unitario) || 0,
         parseFloat(it.desconto_item) || 0,
         it.total, i]
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
  try {
    const r = await db.query(
      `UPDATE orcamentos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND empresa_id=$3 AND status NOT IN ('convertido')
       RETURNING *`,
      [status, id, req.user.empresaId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Orçamento não encontrado ou já convertido.' });
    }
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[orcamentos] status', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

// Converter em venda
router.post('/:id/converter', async (req, res) => {
  const id = parseInt(req.params.id);
  const { forma_pagamento } = req.body || {};
  if (!forma_pagamento) return res.status(400).json({ error: 'Informe a forma de pagamento.' });

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
