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
              t.nome AS transportadora_nome,
              (SELECT COUNT(*) FROM lista_compras lc
               WHERE lc.orcamento_id = o.id AND lc.status IN ('pendente','pedido'))::int AS compras_abertas,
              (SELECT COUNT(*) FROM lista_compras lc
               WHERE lc.orcamento_id = o.id AND lc.status = 'pendente')::int AS compras_pendentes,
              (SELECT COUNT(*) FROM orcamento_itens oi
               WHERE oi.orcamento_id = o.id AND oi.tipo='produto')::int AS itens_total,
              (SELECT COUNT(*) FROM orcamento_itens oi
               WHERE oi.orcamento_id = o.id AND oi.tipo='produto' AND oi.status_separacao='separado')::int AS itens_separados,
              (SELECT COUNT(*) FROM orcamento_itens oi
               WHERE oi.orcamento_id = o.id AND oi.tipo='produto' AND oi.status_separacao='aguardando_compra')::int AS itens_aguardando_compra
       FROM orcamentos o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN transportadoras t ON t.id = o.transportadora_id
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
              c.cidade AS cliente_cidade, c.uf AS cliente_uf,
              t.nome AS transportadora_nome, t.telefone AS transportadora_telefone
       FROM orcamentos o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN transportadoras t ON t.id = o.transportadora_id
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
    desconto, itens, transportadora_id
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
        vendedor_id, vendedor_nome, transportadora_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [req.user.empresaId, numero, cliente_id || null, cliente_nome.trim(),
       validadeDias, dataValidadeIso,
       subtotal, descontoNum, total, observacoes || null, condicoes_pagamento || null,
       req.user.userId, vendedorNome, transportadora_id || null]
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
    desconto, itens, transportadora_id
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
       observacoes=$8, condicoes_pagamento=$9, transportadora_id=$10, atualizado_em=NOW()
       WHERE id=$11`,
      [cliente_id || null, (cliente_nome || '').trim(), validadeDias, dataValidadeIso,
       subtotal, descontoNum, total,
       observacoes || null, condicoes_pagamento || null, transportadora_id || null, id]
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

  // Status permitidos por papel:
  // - vendedor/admin: 'aberto' (voltar rascunho) e 'aprovado' (vendedor confirma que cliente aceitou)
  //   → APROVAR agora dispara pro FINANCEIRO (não gera lista de compras ainda)
  // - Para outras transições, usar rotas específicas: /aprovar-financeiro, /rejeitar-financeiro, /iniciar-separacao, /cancelar
  const validos = ['aberto', 'aprovado'];
  if (!validos.includes(status)) {
    return res.status(400).json({ error: 'Status inválido. Use as rotas específicas: /aprovar-financeiro, /rejeitar-financeiro, /cancelar.' });
  }

  // Vendedor só mexe nos próprios (admin/estoque/financeiro passam)
  const verif = await verificarDonoOrcamento(req, id);
  if (!verif.ok) return res.status(verif.code).json({ error: verif.msg });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Busca status atual pra validar transições
    const rAtual = await client.query(
      'SELECT status FROM orcamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [id, req.user.empresaId]
    );
    if (rAtual.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
    const statusAtual = rAtual.rows[0].status;

    // Não permite voltar de estados avançados via /status
    const estadosBloqueados = ['aguardando_financeiro', 'aprovado_financeiro', 'em_separacao', 'separado', 'convertido', 'cancelado'];
    if (estadosBloqueados.includes(statusAtual) && status !== statusAtual) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Orçamento está em "${statusAtual}" e não pode voltar pra "${status}" por esta rota.` });
    }

    // Se APROVAR: verifica se empresa usa iluminação → vai pro financeiro
    // Se não usa: aprovação direta (fluxo antigo mantido pra compatibilidade)
    let statusFinal = status;
    let iraParaFinanceiro = false;
    if (status === 'aprovado') {
      const empChk = await client.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.user.empresaId]);
      const usaAmbientes = empChk.rows[0]?.usa_ambientes;
      if (usaAmbientes) {
        statusFinal = 'aguardando_financeiro';
        iraParaFinanceiro = true;
      }
    }

    const r = await client.query(
      `UPDATE orcamentos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND empresa_id=$3
       RETURNING *`,
      [statusFinal, id, req.user.empresaId]
    );
    const orcamento = r.rows[0];

    await client.query('COMMIT');
    res.json({
      ...orcamento,
      _iraParaFinanceiro: iraParaFinanceiro,
      _listaComprasCriados: [] // Não gera mais aqui - só quando financeiro aprovar
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orcamentos] status', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  } finally {
    client.release();
  }
});

// POST /:id/aprovar-financeiro — Financeiro aprova pagamento
// Só admin ou financeiro. Gera lista_compras aqui!
// Helper: calcula parcelas iguais (mesma lógica do vendas.js)
function calcularParcelasHelper(total, n, dataPrimeira, intervaloDias) {
  const parcelas = [];
  const valorParcela = Math.round((total / n) * 100) / 100;
  let acumulado = 0;
  for (let i = 0; i < n; i++) {
    let valor = valorParcela;
    if (i === n - 1) {
      // Ajusta última pra fechar centavos
      valor = Math.round((total - acumulado) * 100) / 100;
    }
    acumulado += valor;
    const venc = new Date(dataPrimeira + 'T12:00:00');
    venc.setDate(venc.getDate() + (i * (intervaloDias || 30)));
    parcelas.push({
      numero: i + 1,
      total: n,
      valor: valor,
      vencimento: venc.toISOString().slice(0, 10)
    });
  }
  return parcelas;
}

// POST /:id/aprovar-financeiro — Financeiro aprova pagamento
// AGORA cria a VENDA junto (com status 'em_separacao')
// Gera contas a receber, mas NÃO baixa estoque (estoque só quando Separação concluir)
router.post('/:id/aprovar-financeiro', async (req, res) => {
  const id = parseInt(req.params.id);
  // Opcional: financeiro pode ajustar parcelamento antes de aprovar
  // Body: { formaPagamento?, parcelamento?: { n, dataPrimeira, intervalo } }
  const { formaPagamento, parcelamento } = req.body || {};

  if (!['admin', 'financeiro'].includes(req.user.papel)) {
    return res.status(403).json({ error: 'Apenas admin ou financeiro pode aprovar.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verifica orçamento
    const rOrc = await client.query(
      'SELECT * FROM orcamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [id, req.user.empresaId]
    );
    if (rOrc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
    const orc = rOrc.rows[0];
    if (orc.status !== 'aguardando_financeiro') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Orçamento não está aguardando financeiro (está em "${orc.status}").` });
    }

    // 2. Pega itens do orçamento
    const rItens = await client.query(
      `SELECT * FROM orcamento_itens WHERE orcamento_id=$1 ORDER BY ordem, id`,
      [id]
    );
    if (rItens.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Orçamento sem itens.' });
    }

    // 3. Pega nome do usuário
    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const nomeUsuario = rUser.rows[0]?.nome || null;

    // 4. Monta dados da venda a partir do orçamento
    const hoje = new Date().toISOString().slice(0, 10);
    const clienteNome = orc.cliente_nome || 'Cliente';
    const pagamento = formaPagamento || orc.condicoes_pagamento || 'A definir';
    const subtotal = Number(orc.subtotal) || 0;
    const desconto = Number(orc.desconto) || 0;
    const total = Number(orc.total) || 0;

    // Monta lista de itens no formato da venda
    const itensVenda = rItens.rows.map(it => ({
      produto: it.descricao,
      qtd: Number(it.quantidade),
      preco: Number(it.valor_unitario),
      subtotal: Number(it.total)
    }));

    // Calcula parcelas se aplicável
    let parcelas = [];
    if (parcelamento && parcelamento.n && parcelamento.dataPrimeira && Number(parcelamento.n) > 1) {
      parcelas = calcularParcelasHelper(
        total,
        Number(parcelamento.n),
        parcelamento.dataPrimeira,
        Number(parcelamento.intervalo) || 30
      );
    }

    // 5. CRIA A VENDA (com status 'em_separacao')
    const vendaIns = await client.query(
      `INSERT INTO vendas
        (empresa_id, data, cliente, itens, subtotal, desconto, total, pagamento,
         parcelas, obs, criado_por, transportadora_id, orcamento_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'em_separacao')
       RETURNING *`,
      [req.user.empresaId, hoje, clienteNome, JSON.stringify(itensVenda),
       subtotal, desconto, total, pagamento,
       JSON.stringify(parcelas),
       `Orçamento #${orc.numero} · Aprovado por ${nomeUsuario}`,
       req.user.userId, orc.transportadora_id, id]
    );
    const venda = vendaIns.rows[0];

    // 6. GERA CONTAS A RECEBER (não depende de separação!)
    if (parcelas.length > 0) {
      // Parcelado
      for (const par of parcelas) {
        await client.query(
          `INSERT INTO contas_receber (empresa_id, cliente, descricao, valor, vencimento, status, venda_id)
           VALUES ($1,$2,$3,$4,$5,'Pendente',$6)`,
          [req.user.empresaId, clienteNome, `Venda #${venda.id} Parcela ${par.numero}/${par.total}`,
           par.valor, par.vencimento, venda.id]
        );
      }
    } else if (total > 0) {
      // À vista → já registra como recebida na data de hoje
      await client.query(
        `INSERT INTO contas_receber (empresa_id, cliente, descricao, valor, vencimento, status, data_recebimento, venda_id)
         VALUES ($1,$2,$3,$4,$5,'Recebida',$5,$6)`,
        [req.user.empresaId, clienteNome, `Venda #${venda.id} - ${pagamento}`,
         total, hoje, venda.id]
      );
    }

    // 7. IMPORTANTE: NÃO baixa estoque nem cria movimentações
    // Isso será feito pelo Estoque quando marcar itens como separados (LOTE 3)

    // 8. Atualiza orçamento → aprovado_financeiro + vincula à venda
    await client.query(
      `UPDATE orcamentos
       SET status='aprovado_financeiro',
           financeiro_aprovado_por=$1, financeiro_aprovado_por_nome=$2,
           financeiro_aprovado_em=NOW(),
           venda_id=$3,
           atualizado_em=NOW()
       WHERE id=$4`,
      [req.user.userId, nomeUsuario, venda.id, id]
    );

    // 9. Gera lista_compras pra itens sem estoque suficiente
    let itensCriados = [];
    for (const item of rItens.rows) {
      if (item.tipo !== 'produto' || !item.produto_id) continue;
      // Busca dados do produto
      const rProd = await client.query(
        'SELECT nome, codigo, referencia, estoque FROM produtos WHERE id=$1',
        [item.produto_id]
      );
      if (rProd.rows.length === 0) continue;
      const p = rProd.rows[0];
      const estoque = Number(p.estoque) || 0;
      const qtdOrc = Number(item.quantidade) || 0;
      const faltando = qtdOrc - estoque;

      if (faltando > 0) {
        await client.query(
          `UPDATE orcamento_itens SET status_separacao='aguardando_compra' WHERE id=$1`,
          [item.id]
        );
        const jaExiste = await client.query(
          `SELECT id FROM lista_compras
           WHERE empresa_id=$1 AND orcamento_id=$2 AND produto_id=$3`,
          [req.user.empresaId, id, item.produto_id]
        );
        if (jaExiste.rows.length === 0) {
          const ins = await client.query(
            `INSERT INTO lista_compras (empresa_id, orcamento_id, produto_id, produto_nome,
                                        produto_codigo, referencia, quantidade, status, criado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pendente',$8)
             RETURNING produto_nome, quantidade`,
            [req.user.empresaId, id, item.produto_id, p.nome,
             p.codigo, p.referencia, faltando, req.user.userId]
          );
          itensCriados.push({
            produto: ins.rows[0].produto_nome,
            quantidade: Number(ins.rows[0].quantidade)
          });
        }
      }
    }

    // 10. Cria cliente se não existir (mesma lógica de venda direta)
    const cliExist = await client.query(
      'SELECT id FROM clientes WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2)',
      [req.user.empresaId, clienteNome]
    );
    if (cliExist.rows.length === 0) {
      await client.query('INSERT INTO clientes (empresa_id, nome) VALUES ($1,$2)', [req.user.empresaId, clienteNome]);
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      aprovadoPor: nomeUsuario,
      vendaId: venda.id,
      itensAguardandoCompra: itensCriados,
      parcelasGeradas: parcelas.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orcamentos] aprovar-financeiro', err);
    res.status(500).json({ error: 'Erro ao aprovar financeiramente: ' + err.message });
  } finally {
    client.release();
  }
});

// POST /:id/rejeitar-financeiro — Financeiro rejeita com motivo
// Volta pro vendedor editar (status: rejeitado_financeiro)
router.post('/:id/rejeitar-financeiro', async (req, res) => {
  const id = parseInt(req.params.id);
  const { motivo } = req.body || {};

  if (!['admin', 'financeiro'].includes(req.user.papel)) {
    return res.status(403).json({ error: 'Apenas admin ou financeiro pode rejeitar.' });
  }
  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({ error: 'Motivo obrigatório (mínimo 5 caracteres).' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const rOrc = await client.query(
      'SELECT status FROM orcamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [id, req.user.empresaId]
    );
    if (rOrc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
    if (rOrc.rows[0].status !== 'aguardando_financeiro') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Só pode rejeitar orçamento em "aguardando_financeiro" (está em "${rOrc.rows[0].status}").` });
    }

    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const nomeUsuario = rUser.rows[0]?.nome || null;

    await client.query(
      `UPDATE orcamentos
       SET status='rejeitado_financeiro',
           financeiro_rejeitado_por=$1, financeiro_rejeitado_por_nome=$2,
           financeiro_rejeitado_em=NOW(), motivo_rejeicao_financeira=$3,
           atualizado_em=NOW()
       WHERE id=$4`,
      [req.user.userId, nomeUsuario, motivo.trim(), id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, rejeitadoPor: nomeUsuario });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orcamentos] rejeitar-financeiro', err);
    res.status(500).json({ error: 'Erro ao rejeitar.' });
  } finally {
    client.release();
  }
});

// Marcar orçamento como convertido (quando a venda já foi criada via fluxo do modal)
// POST /:id/cancelar — Cancela orçamento com auditoria completa
// Regras:
//   - Se orçamento tem itens em lista_compras com status 'pedido' ou 'recebido': BLOQUEIA
//   - Se quem clica é vendedor: exige senha de um admin
//   - Se quem clica é admin: exige a própria senha
//   - Remove itens 'pendente' da lista_compras
//   - Grava: cancelado_por, autorizado_por, motivo, timestamp
router.post('/:id/cancelar', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const id = parseInt(req.params.id);
  const { motivo, senha } = req.body || {};

  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({ error: 'Motivo obrigatório (mínimo 5 caracteres).' });
  }
  if (!senha) {
    return res.status(400).json({ error: 'Senha do admin obrigatória.' });
  }

  // Vendedor só cancela seus próprios
  const verif = await verificarDonoOrcamento(req, id);
  if (!verif.ok) return res.status(verif.code).json({ error: verif.msg });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Valida orçamento
    const rOrc = await client.query(
      'SELECT id, status FROM orcamentos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',
      [id, req.user.empresaId]
    );
    if (rOrc.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
    const orc = rOrc.rows[0];
    if (orc.status === 'cancelado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Orçamento já está cancelado.' });
    }
    if (orc.status === 'convertido') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Orçamento já foi convertido em venda e não pode ser cancelado.' });
    }

    // 2. Verifica compras: se tem 'pedido' ou 'recebido', bloqueia
    const rCompras = await client.query(
      `SELECT status, produto_nome
       FROM lista_compras
       WHERE orcamento_id=$1 AND empresa_id=$2 AND status IN ('pedido', 'recebido')`,
      [id, req.user.empresaId]
    );
    if (rCompras.rows.length > 0) {
      await client.query('ROLLBACK');
      const detalhes = rCompras.rows.map(x => `${x.produto_nome} (${x.status})`).join(', ');
      return res.status(400).json({
        error: `Não é possível cancelar: existem itens já pedidos ou recebidos na Lista de Compras. Itens: ${detalhes}`
      });
    }

    // 3. Valida senha do admin
    // Vendedor: procura admin cuja senha bate. Admin: usa a própria senha.
    let adminAutorizador = null;
    if (req.user.papel === 'admin') {
      const rMe = await client.query(
        'SELECT id, nome, senha_hash FROM usuarios WHERE id=$1 LIMIT 1',
        [req.user.userId]
      );
      if (rMe.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Usuário não encontrado.' });
      }
      const okSenha = await bcrypt.compare(senha, rMe.rows[0].senha_hash);
      if (!okSenha) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Senha incorreta.' });
      }
      adminAutorizador = { id: rMe.rows[0].id, nome: rMe.rows[0].nome };
    } else {
      // Vendedor: verifica se a senha bate com algum admin da empresa
      const rAdmins = await client.query(
        `SELECT id, nome, senha_hash FROM usuarios
         WHERE empresa_id=$1 AND papel='admin'`,
        [req.user.empresaId]
      );
      for (const adm of rAdmins.rows) {
        const ok = await bcrypt.compare(senha, adm.senha_hash);
        if (ok) {
          adminAutorizador = { id: adm.id, nome: adm.nome };
          break;
        }
      }
      if (!adminAutorizador) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Senha de admin incorreta. Peça a autorização a um administrador.' });
      }
    }

    // 4. Pega nome do usuário que está cancelando
    const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
    const canceladoPorNome = rUser.rows[0]?.nome || null;

    // 5. Remove itens PENDENTES da lista_compras (limpeza)
    const rRemovidos = await client.query(
      `DELETE FROM lista_compras
       WHERE orcamento_id=$1 AND empresa_id=$2 AND status='pendente'
       RETURNING produto_nome`,
      [id, req.user.empresaId]
    );

    // 6. Atualiza orçamento
    await client.query(
      `UPDATE orcamentos
       SET status='cancelado',
           cancelado_por=$1, cancelado_por_nome=$2,
           autorizado_por=$3, autorizado_por_nome=$4,
           cancelado_em=NOW(), motivo_cancelamento=$5,
           atualizado_em=NOW()
       WHERE id=$6`,
      [req.user.userId, canceladoPorNome,
       adminAutorizador.id, adminAutorizador.nome,
       motivo.trim(), id]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      canceladoPor: canceladoPorNome,
      autorizadoPor: adminAutorizador.nome,
      itensRemovidosDaListaCompras: rRemovidos.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orcamentos] cancelar', err);
    res.status(500).json({ error: 'Erro ao cancelar orçamento.' });
  } finally {
    client.release();
  }
});

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

    // Bloqueia exclusão se há itens na lista_compras com status 'pedido' ou 'recebido'
    const rCompras = await db.query(
      `SELECT status, produto_nome FROM lista_compras
       WHERE orcamento_id=$1 AND empresa_id=$2 AND status IN ('pedido','recebido')`,
      [id, req.user.empresaId]
    );
    if (rCompras.rows.length > 0) {
      const detalhes = rCompras.rows.map(x => `${x.produto_nome} (${x.status})`).join(', ');
      return res.status(400).json({
        error: `Não é possível excluir: existem itens já pedidos ou recebidos na Lista de Compras. Itens: ${detalhes}. Cancele o orçamento em vez de excluir.`
      });
    }

    // Remove itens pendentes da lista_compras
    await db.query(
      `DELETE FROM lista_compras
       WHERE orcamento_id=$1 AND empresa_id=$2 AND status='pendente'`,
      [id, req.user.empresaId]
    );

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
