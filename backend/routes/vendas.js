const express = require('express');
const db = require('../db');
const bcrypt = require('bcryptjs');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};
const toNum = (v) => (v == null ? 0 : Number(v));

function calcularParcelas(total, n, dataPrimeiraIso, intervaloDias) {
  const parcelas = [];
  const valorBase = Math.floor((total / n) * 100) / 100;
  let acumulado = 0;
  for (let i = 0; i < n; i++) {
    const valor = (i === n - 1) ? Math.round((total - acumulado) * 100) / 100 : valorBase;
    acumulado += valor;
    const d = new Date(dataPrimeiraIso + 'T12:00:00');
    d.setDate(d.getDate() + intervaloDias * i);
    parcelas.push({
      numero: i + 1, total: n, valor,
      vencimento: d.toISOString().slice(0, 10)
    });
  }
  return parcelas;
}

// Listar vendas (com info de orçamento vinculado, se houver)
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT v.*,
              o.id AS orcamento_id_vinculado,
              o.numero AS orcamento_numero_vinculado
       FROM vendas v
       LEFT JOIN orcamentos o ON o.venda_id = v.id AND o.empresa_id = v.empresa_id
       WHERE v.empresa_id=$1
       ORDER BY v.data DESC, v.id DESC`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(v => ({
      ...camelizar(v),
      subtotal: toNum(v.subtotal), desconto: toNum(v.desconto), total: toNum(v.total),
      itens: v.itens || [], parcelas: v.parcelas || []
    })));
  } catch (err) {
    console.error('[vendas/list]', err);
    res.status(500).json({ error: 'Erro ao listar vendas.' });
  }
});

// Criar venda — transação: dá baixa no estoque, cria movimentações, gera contas a receber
router.post('/', async (req, res) => {
  const { data, cliente, itens, desconto, pagamento, parcelamento, obs } = req.body || {};
  if (!cliente) return res.status(400).json({ error: 'Cliente é obrigatório.' });
  if (!data) return res.status(400).json({ error: 'Data é obrigatória.' });
  if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'Adicione ao menos um item.' });

  // Valida itens
  for (const it of itens) {
    if (!it.produto || !it.qtd || it.qtd <= 0) return res.status(400).json({ error: 'Cada item precisa de produto e quantidade > 0.' });
    if (!it.preco || it.preco <= 0) return res.status(400).json({ error: 'Preço unitário inválido.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Busca produtos E serviços cadastrados (todo item precisa estar em um dos dois)
    const nomes = [...new Set(itens.map(i => i.produto))];
    const prodResult = await client.query(
      'SELECT * FROM produtos WHERE empresa_id=$1 AND nome = ANY($2::text[])',
      [req.user.empresaId, nomes]
    );
    const produtosByNome = new Map(prodResult.rows.map(p => [p.nome, p]));

    const servResult = await client.query(
      'SELECT * FROM servicos WHERE empresa_id=$1 AND ativo=TRUE AND nome = ANY($2::text[])',
      [req.user.empresaId, nomes]
    );
    const servicosByNome = new Map(servResult.rows.map(s => [s.nome, s]));

    // Soma quantidades por nome (pra checar estoque dos produtos)
    const qtdPorNome = {};
    for (const it of itens) qtdPorNome[it.produto] = (qtdPorNome[it.produto] || 0) + Number(it.qtd);

    // Valida cada item: precisa estar em produtos OU serviços. Senão bloqueia.
    for (const nome in qtdPorNome) {
      const p = produtosByNome.get(nome);
      const s = servicosByNome.get(nome);
      if (!p && !s) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `"${nome}" não está cadastrado como produto nem como serviço. Cadastre antes de vender.` });
      }
      // Se for produto, valida estoque
      if (p && toNum(p.estoque) < qtdPorNome[nome]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Estoque insuficiente para "${nome}". Disponível: ${toNum(p.estoque)}, solicitado: ${qtdPorNome[nome]}.` });
      }
      // Se for serviço, passa direto (sem estoque)
    }

    // Calcula totais
    const subtotal = itens.reduce((s, i) => s + Number(i.qtd) * Number(i.preco), 0);
    const desc = Number(desconto) || 0;
    const total = Math.max(0, subtotal - desc);

    // Calcula parcelas
    let parcelas = [];
    if (pagamento === 'A Prazo' || pagamento === 'Boleto') {
      if (!parcelamento || !parcelamento.n || !parcelamento.dataPrimeira) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Informe nº de parcelas e data da primeira para esse tipo de pagamento.' });
      }
      parcelas = calcularParcelas(total, Number(parcelamento.n), parcelamento.dataPrimeira, Number(parcelamento.intervalo) || 30);
    }

    // Cria a venda
    const vendaIns = await client.query(
      `INSERT INTO vendas (empresa_id, data, cliente, itens, subtotal, desconto, total, pagamento, parcelas, obs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.empresaId, data, cliente, JSON.stringify(itens), subtotal, desc, total, pagamento, JSON.stringify(parcelas), obs || null]
    );
    const venda = vendaIns.rows[0];

    // Para cada item: produto baixa estoque + movimentação. Serviço só passa direto.
    for (const it of itens) {
      const p = produtosByNome.get(it.produto);
      if (!p) continue; // é serviço (já foi validado lá em cima): sem estoque, sem movimentação
      await client.query(
        'UPDATE produtos SET estoque = estoque - $1 WHERE id = $2 AND empresa_id = $3',
        [Number(it.qtd), p.id, req.user.empresaId]
      );
      await client.query(
        `INSERT INTO movimentacoes (empresa_id, produto_codigo, produto_nome, data, tipo, qtd, origem, observacao, venda_id)
         VALUES ($1,$2,$3,$4,'saida',$5,$6,$7,$8)`,
        [req.user.empresaId, p.codigo, p.nome, data, Number(it.qtd),
         `Venda #${venda.id}`, `Cliente: ${cliente} · Preço unit.: R$ ${Number(it.preco).toFixed(2)}`, venda.id]
      );
    }

    // Gera contas a receber
    if (parcelas.length > 0) {
      // Venda parcelada (A Prazo / Boleto)
      for (const par of parcelas) {
        await client.query(
          `INSERT INTO contas_receber (empresa_id, cliente, descricao, valor, vencimento, status, venda_id)
           VALUES ($1,$2,$3,$4,$5,'Pendente',$6)`,
          [req.user.empresaId, cliente, `Venda #${venda.id} Parcela ${par.numero}/${par.total}`,
           par.valor, par.vencimento, venda.id]
        );
      }
    } else if (total > 0) {
      // Venda à vista (PIX, Cartão, Dinheiro etc.) — registra como Recebida na mesma data
      await client.query(
        `INSERT INTO contas_receber (empresa_id, cliente, descricao, valor, vencimento, status, data_recebimento, venda_id)
         VALUES ($1,$2,$3,$4,$5,'Recebida',$5,$6)`,
        [req.user.empresaId, cliente, `Venda #${venda.id} - ${pagamento || 'À vista'}`,
         total, data, venda.id]
      );
    }

    // Cliente novo? cadastra
    const cliExist = await client.query(
      'SELECT id FROM clientes WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2)',
      [req.user.empresaId, cliente]
    );
    if (cliExist.rows.length === 0) {
      await client.query('INSERT INTO clientes (empresa_id, nome) VALUES ($1,$2)', [req.user.empresaId, cliente]);
    }

    await client.query('COMMIT');
    res.json({
      ...camelizar(venda),
      subtotal: toNum(venda.subtotal), desconto: toNum(venda.desconto), total: toNum(venda.total),
      itens: venda.itens, parcelas: venda.parcelas
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[vendas/create]', err);
    res.status(500).json({ error: 'Erro ao registrar venda.' });
  } finally {
    client.release();
  }
});

// Excluir venda — reverte estoque e contas a receber pendentes
router.delete('/:id', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const movs = await client.query(
      "SELECT * FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2 AND tipo='saida'",
      [req.params.id, req.user.empresaId]
    );
    // Devolve estoque
    for (const m of movs.rows) {
      await client.query(
        'UPDATE produtos SET estoque = estoque + $1 WHERE empresa_id=$2 AND codigo=$3',
        [m.qtd, req.user.empresaId, m.produto_codigo]
      );
    }
    await client.query('DELETE FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    await client.query(
      "DELETE FROM contas_receber WHERE venda_id=$1 AND empresa_id=$2",
      [req.params.id, req.user.empresaId]);
    const r = await client.query('DELETE FROM vendas WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [req.params.id, req.user.empresaId]);
    if (r.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Venda não encontrada.' }); }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[vendas/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir venda.' });
  } finally {
    client.release();
  }
});

// Cancelar venda (mantém histórico, marca como 'cancelada')
// Requer: senha de QUALQUER admin da empresa + motivo
// Faz: devolve estoque, apaga contas a receber, marca venda como cancelada
router.post('/:id/cancelar', async (req, res) => {
  const vendaId = parseInt(req.params.id);
  if (isNaN(vendaId)) return res.status(400).json({ error: 'ID inválido.' });

  const { senha, motivo } = req.body || {};
  const motivoNorm = (motivo || '').trim();
  if (!senha) return res.status(400).json({ error: 'Senha do administrador é obrigatória.' });
  if (motivoNorm.length < 5) return res.status(400).json({ error: 'Informe um motivo (mínimo 5 caracteres).' });
  if (motivoNorm.length > 500) return res.status(400).json({ error: 'Motivo muito longo (máx 500 caracteres).' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Valida senha contra QUALQUER admin da empresa
    const admins = await client.query(
      "SELECT id, nome, senha_hash FROM usuarios WHERE empresa_id=$1 AND papel='admin'",
      [req.user.empresaId]
    );
    if (admins.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Nenhum administrador cadastrado.' });
    }
    let adminValidado = null;
    for (const a of admins.rows) {
      try {
        if (await bcrypt.compare(senha, a.senha_hash)) { adminValidado = a; break; }
      } catch (e) {}
    }
    if (!adminValidado) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Senha de administrador incorreta.' });
    }

    // 2) Confirma que a venda existe e ainda está ATIVA
    const vQ = await client.query(
      'SELECT id, status FROM vendas WHERE id=$1 AND empresa_id=$2',
      [vendaId, req.user.empresaId]
    );
    if (vQ.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }
    if (vQ.rows[0].status === 'cancelada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Venda já está cancelada.' });
    }

    // 3) Devolve estoque (e apaga movimentações de saída pra não duplicar)
    const movs = await client.query(
      "SELECT * FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2 AND tipo='saida'",
      [vendaId, req.user.empresaId]
    );
    for (const m of movs.rows) {
      await client.query(
        'UPDATE produtos SET estoque = estoque + $1 WHERE empresa_id=$2 AND codigo=$3',
        [m.qtd, req.user.empresaId, m.produto_codigo]
      );
    }
    await client.query(
      'DELETE FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2',
      [vendaId, req.user.empresaId]
    );

    // 4) Remove contas a receber geradas pela venda
    await client.query(
      "DELETE FROM contas_receber WHERE venda_id=$1 AND empresa_id=$2",
      [vendaId, req.user.empresaId]
    );

    // 5) Marca a venda como cancelada (preserva histórico)
    const r = await client.query(
      `UPDATE vendas SET
         status = 'cancelada',
         cancelada_em = NOW(),
         cancelada_por_id = $1,
         cancelada_por_nome = $2,
         motivo_cancelamento = $3
       WHERE id=$4 AND empresa_id=$5 RETURNING id`,
      [adminValidado.id, adminValidado.nome, motivoNorm, vendaId, req.user.empresaId]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      venda_id: vendaId,
      cancelada_por: adminValidado.nome,
      motivo: motivoNorm
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[vendas/cancelar]', err);
    res.status(500).json({ error: 'Erro ao cancelar venda: ' + err.message });
  } finally {
    client.release();
  }
});

// Cancelar venda E reabrir orçamento vinculado (se houver)
// Devolve estoque, remove contas a receber, marca orçamento de volta como 'aprovado'
router.post('/:id/cancelar-e-reabrir-orcamento', async (req, res) => {
  const vendaId = parseInt(req.params.id);
  if (isNaN(vendaId)) return res.status(400).json({ error: 'ID inválido.' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Localiza o orçamento vinculado (se houver)
    const orcQ = await client.query(
      "SELECT id, numero FROM orcamentos WHERE venda_id=$1 AND empresa_id=$2 LIMIT 1",
      [vendaId, req.user.empresaId]
    );
    const orcamento = orcQ.rows[0];

    // 2) Devolve estoque
    const movs = await client.query(
      "SELECT * FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2 AND tipo='saida'",
      [vendaId, req.user.empresaId]
    );
    for (const m of movs.rows) {
      await client.query(
        'UPDATE produtos SET estoque = estoque + $1 WHERE empresa_id=$2 AND codigo=$3',
        [m.qtd, req.user.empresaId, m.produto_codigo]
      );
    }
    await client.query(
      'DELETE FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2',
      [vendaId, req.user.empresaId]
    );

    // 3) Remove contas a receber
    await client.query(
      "DELETE FROM contas_receber WHERE venda_id=$1 AND empresa_id=$2",
      [vendaId, req.user.empresaId]
    );

    // 4) Apaga a venda
    const r = await client.query(
      'DELETE FROM vendas WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [vendaId, req.user.empresaId]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }

    // 5) Se tinha orçamento vinculado, volta ele pra status 'aprovado' e limpa venda_id
    let orcamentoReaberto = null;
    if (orcamento) {
      await client.query(
        "UPDATE orcamentos SET status='aprovado', venda_id=NULL, atualizado_em=NOW() WHERE id=$1 AND empresa_id=$2",
        [orcamento.id, req.user.empresaId]
      );
      orcamentoReaberto = { id: orcamento.id, numero: orcamento.numero };
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      venda_cancelada: vendaId,
      orcamento_reaberto: orcamentoReaberto
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[vendas/cancelar-e-reabrir-orcamento]', err);
    res.status(500).json({ error: 'Erro ao cancelar venda e reabrir orçamento.' });
  } finally {
    client.release();
  }
});

module.exports = router;
