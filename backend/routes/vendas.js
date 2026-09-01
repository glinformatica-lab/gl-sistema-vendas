const express = require('express');
const db = require('../db');
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

// Listar vendas
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT v.*,
              uc.nome AS criado_por_nome,
              ucan.nome AS cancelada_por_nome,
              t.nome AS transportadora_nome,
              COALESCE(
                (SELECT json_agg(json_build_object(
                    'id', ns.id,
                    'numero', ns.numero,
                    'serie', ns.serie,
                    'tipo', ns.tipo,
                    'chave', ns.chave,
                    'status_nfe', ns.status_nfe
                  ) ORDER BY ns.data DESC, ns.id DESC)
                 FROM notas_saida ns WHERE ns.venda_id = v.id),
                '[]'::json
              ) AS notas_fiscais
       FROM vendas v
       LEFT JOIN usuarios uc ON uc.id = v.criado_por
       LEFT JOIN usuarios ucan ON ucan.id = v.cancelada_por
       LEFT JOIN transportadoras t ON t.id = v.transportadora_id
       WHERE v.empresa_id=$1 ORDER BY v.data DESC, v.id DESC`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(v => ({
      ...camelizar(v),
      subtotal: toNum(v.subtotal), desconto: toNum(v.desconto), total: toNum(v.total),
      itens: v.itens || [], parcelas: v.parcelas || [],
      notasFiscais: v.notas_fiscais || []
    })));
  } catch (err) {
    console.error('[vendas/list]', err);
    res.status(500).json({ error: 'Erro ao listar vendas.' });
  }
});

// Criar venda — transação: dá baixa no estoque, cria movimentações, gera contas a receber
router.post('/', async (req, res) => {
  const { data, cliente, itens, desconto, pagamento, parcelamento, obs, transportadora_id, creditoUsado } = req.body || {};
  if (!cliente) return res.status(400).json({ error: 'Cliente é obrigatório.' });
  if (!data) return res.status(400).json({ error: 'Data é obrigatória.' });
  if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'Adicione ao menos um item.' });

  const creditoValor = Number(creditoUsado) || 0;
  if (creditoValor < 0) return res.status(400).json({ error: 'Crédito usado não pode ser negativo.' });

  // Valida itens
  for (const it of itens) {
    if (!it.produto || !it.qtd || it.qtd <= 0) return res.status(400).json({ error: 'Cada item precisa de produto e quantidade > 0.' });
    if (!it.preco || it.preco <= 0) return res.status(400).json({ error: 'Preço unitário inválido.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Busca produtos cadastrados (itens livres como serviços/avulsos não precisam ter)
    const nomes = [...new Set(itens.map(i => i.produto))];
    const prodResult = await client.query(
      'SELECT * FROM produtos WHERE empresa_id=$1 AND nome = ANY($2::text[])',
      [req.user.empresaId, nomes]
    );
    const produtosByNome = new Map(prodResult.rows.map(p => [p.nome, p]));

    // Soma quantidades por produto (apenas dos cadastrados, pra checar estoque)
    const qtdPorNome = {};
    for (const it of itens) qtdPorNome[it.produto] = (qtdPorNome[it.produto] || 0) + Number(it.qtd);

    // Valida estoque APENAS para os que estão cadastrados.
    // Itens não cadastrados (serviços/avulsos) passam livremente.
    for (const nome in qtdPorNome) {
      const p = produtosByNome.get(nome);
      if (!p) continue; // item livre
      if (toNum(p.estoque) < qtdPorNome[nome]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Estoque insuficiente para "${nome}". Disponível: ${toNum(p.estoque)}, solicitado: ${qtdPorNome[nome]}.` });
      }
    }

    // Calcula totais
    const subtotal = itens.reduce((s, i) => s + Number(i.qtd) * Number(i.preco), 0);
    const desc = Number(desconto) || 0;
    const total = Math.max(0, subtotal - desc);

    // ===== VALIDAÇÃO DE CRÉDITO DE DEVOLUÇÃO (só módulo iluminação) =====
    let creditoInfo = null;
    let clienteRegistro = null;
    if (creditoValor > 0) {
      const rEmp = await client.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
      if (!rEmp.rows[0]?.usa_ambientes) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Crédito de devolução disponível apenas no módulo Iluminação.' });
      }

      const rCli = await client.query(
        `SELECT id, credito_saldo FROM clientes
         WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2) FOR UPDATE`,
        [req.user.empresaId, cliente]
      );
      if (rCli.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cliente precisa estar cadastrado para usar crédito.' });
      }
      clienteRegistro = rCli.rows[0];
      const saldoAtual = Number(clienteRegistro.credito_saldo) || 0;
      if (creditoValor > saldoAtual) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Saldo insuficiente. Disponível: R$ ${saldoAtual.toFixed(2)} · Solicitado: R$ ${creditoValor.toFixed(2)}`
        });
      }
      if (creditoValor > total) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Crédito (R$ ${creditoValor.toFixed(2)}) maior que o total da venda (R$ ${total.toFixed(2)}).`
        });
      }
      creditoInfo = { clienteId: clienteRegistro.id, valor: creditoValor };
    }

    // Total efetivamente a pagar (após abater crédito)
    const totalAPagar = Math.max(0, total - creditoValor);

    // Calcula parcelas (baseado no totalAPagar, não no total bruto)
    let parcelas = [];
    if (totalAPagar > 0 && (pagamento === 'A Prazo' || pagamento === 'Boleto')) {
      if (!parcelamento || !parcelamento.n || !parcelamento.dataPrimeira) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Informe nº de parcelas e data da primeira para esse tipo de pagamento.' });
      }
      parcelas = calcularParcelas(totalAPagar, Number(parcelamento.n), parcelamento.dataPrimeira, Number(parcelamento.intervalo) || 30);
    }

    // Cria a venda
    const vendaIns = await client.query(
      `INSERT INTO vendas (empresa_id, data, cliente, itens, subtotal, desconto, total, pagamento, parcelas, obs, criado_por, transportadora_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.empresaId, data, cliente, JSON.stringify(itens), subtotal, desc, total, pagamento, JSON.stringify(parcelas), obs || null, req.user.userId, transportadora_id || null]
    );
    const venda = vendaIns.rows[0];

    // Para cada item: baixa estoque + movimentação (APENAS para produtos cadastrados)
    for (const it of itens) {
      const p = produtosByNome.get(it.produto);
      if (!p) continue; // item livre (serviço/avulso): sem estoque nem movimentação
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

    // ===== USA CRÉDITO DE DEVOLUÇÃO (se solicitado) =====
    let creditoAplicado = null;
    if (creditoInfo && creditoInfo.valor > 0) {
      try {
        const { usarCredito } = require('./creditos');
        const rUser = await client.query('SELECT nome FROM usuarios WHERE id=$1', [req.user.userId]);
        const r = await usarCredito(client, {
          empresaId: req.user.empresaId,
          clienteId: creditoInfo.clienteId,
          valor: creditoInfo.valor,
          destinoVendaId: venda.id,
          criadoPor: req.user.userId,
          criadoPorNome: rUser.rows[0]?.nome || null
        });
        creditoAplicado = {
          valor: creditoInfo.valor,
          saldoAntes: r.saldoAntes,
          saldoDepois: r.saldoDepois
        };
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Erro ao usar crédito: ' + e.message });
      }
    }

    await client.query('COMMIT');
    res.json({
      ...camelizar(venda),
      subtotal: toNum(venda.subtotal), desconto: toNum(venda.desconto), total: toNum(venda.total),
      itens: venda.itens, parcelas: venda.parcelas,
      creditoAplicado
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

// ==== CANCELAR VENDA (mantém no banco com status='cancelada') ====
// Devolve estoque e remove contas a receber, mas mantém histórico
router.post('/:id/cancelar', async (req, res) => {
  const { motivo, senha, gerarCredito } = req.body || {};
  const bcrypt = require('bcryptjs');
  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({ error: 'Motivo obrigatório (mínimo 5 caracteres).' });
  }
  if (!senha) {
    return res.status(400).json({ error: 'Senha do admin obrigatória.' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // 1. Valida se venda existe e não está cancelada
    // Busca cliente_id via nome (tabela vendas guarda só o nome do cliente)
    const rVenda = await client.query(
      `SELECT v.id, v.status, v.cliente, v.total,
              (SELECT id FROM clientes WHERE empresa_id=v.empresa_id AND LOWER(nome)=LOWER(v.cliente) LIMIT 1) AS cliente_id
       FROM vendas v WHERE v.id=$1 AND v.empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rVenda.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }
    if (rVenda.rows[0].status === 'cancelada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Venda já está cancelada.' });
    }
    const vendaAtual = rVenda.rows[0];
    // 2. Valida senha do usuário atual (que precisa ser admin)
    const rUser = await client.query(
      'SELECT id, nome, senha_hash, papel FROM usuarios WHERE id=$1 LIMIT 1',
      [req.user.userId]
    );
    if (rUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }
    const usr = rUser.rows[0];
    if (usr.papel !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Apenas administradores podem cancelar vendas.' });
    }
    const okSenha = await bcrypt.compare(senha, usr.senha_hash);
    if (!okSenha) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    // 3. Devolve estoque (percorre movimentações de saída da venda)
    const movs = await client.query(
      "SELECT * FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2 AND tipo='saida'",
      [req.params.id, req.user.empresaId]
    );
    for (const m of movs.rows) {
      await client.query(
        'UPDATE produtos SET estoque = estoque + $1 WHERE empresa_id=$2 AND codigo=$3',
        [m.qtd, req.user.empresaId, m.produto_codigo]
      );
    }
    // Remove movimentações
    await client.query(
      'DELETE FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]
    );
    // 4. Remove contas a receber
    await client.query(
      'DELETE FROM contas_receber WHERE venda_id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]
    );
    // 5. Marca venda como cancelada
    await client.query(
      `UPDATE vendas SET status='cancelada',
              motivo_cancelamento=$1,
              cancelada_por=$2,
              cancelada_em=NOW()
       WHERE id=$3 AND empresa_id=$4`,
      [motivo.trim(), req.user.userId, req.params.id, req.user.empresaId]
    );

    // 6. Se solicitado, gera crédito de devolução ao cliente
    let creditoGerado = null;
    if (gerarCredito && vendaAtual.cliente_id) {
      // Só se módulo iluminação
      const rEmp = await client.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
      if (rEmp.rows[0]?.usa_ambientes) {
        try {
          const { adicionarCredito } = require('./creditos');
          const valorCredito = Number(vendaAtual.total) || 0;
          if (valorCredito > 0) {
            const r = await adicionarCredito(client, {
              empresaId: req.user.empresaId,
              clienteId: vendaAtual.cliente_id,
              valor: valorCredito,
              origemVendaId: parseInt(req.params.id),
              motivo: `Devolução venda #${req.params.id}: ${motivo.trim()}`,
              criadoPor: req.user.userId,
              criadoPorNome: usr.nome
            });
            creditoGerado = {
              valor: valorCredito,
              saldoAntes: r.saldoAntes,
              saldoDepois: r.saldoDepois
            };
          }
        } catch (e) {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: 'Erro ao gerar crédito: ' + e.message });
        }
      }
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      cancelada_por: usr.nome,
      motivo: motivo.trim(),
      creditoGerado
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[vendas/cancelar]', err);
    // Detecta erros comuns de estrutura de banco
    if (err.code === '42703') {
      return res.status(500).json({ error: 'Erro: coluna faltando no banco. Rode a migration v27.' });
    }
    res.status(500).json({ error: 'Erro ao cancelar venda: ' + (err.message || 'desconhecido') });
  } finally {
    client.release();
  }
});

// ==== CANCELAR VENDA E REABRIR ORÇAMENTO ====
router.post('/:id/cancelar-e-reabrir-orcamento', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Busca venda + orçamento vinculado
    const rVenda = await client.query(
      `SELECT v.id, v.status, o.id AS orc_id, o.numero AS orc_numero
       FROM vendas v
       LEFT JOIN orcamentos o ON o.venda_id = v.id
       WHERE v.id=$1 AND v.empresa_id=$2 FOR UPDATE`,
      [req.params.id, req.user.empresaId]
    );
    if (rVenda.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }
    const v = rVenda.rows[0];
    if (v.status === 'cancelada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Venda já está cancelada.' });
    }
    if (!v.orc_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta venda não tem orçamento vinculado.' });
    }
    // Devolve estoque
    const movs = await client.query(
      "SELECT * FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2 AND tipo='saida'",
      [req.params.id, req.user.empresaId]
    );
    for (const m of movs.rows) {
      await client.query(
        'UPDATE produtos SET estoque = estoque + $1 WHERE empresa_id=$2 AND codigo=$3',
        [m.qtd, req.user.empresaId, m.produto_codigo]
      );
    }
    await client.query(
      'DELETE FROM movimentacoes WHERE venda_id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]
    );
    await client.query(
      'DELETE FROM contas_receber WHERE venda_id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]
    );
    // Marca venda como cancelada
    await client.query(
      `UPDATE vendas SET status='cancelada',
              motivo_cancelamento='Reaberto para edição do orçamento',
              cancelada_por=$1, cancelada_em=NOW()
       WHERE id=$2 AND empresa_id=$3`,
      [req.user.userId, req.params.id, req.user.empresaId]
    );
    // Reabre orçamento (status='aberto', desvincula venda_id)
    await client.query(
      `UPDATE orcamentos SET status='aberto', venda_id=NULL WHERE id=$1 AND empresa_id=$2`,
      [v.orc_id, req.user.empresaId]
    );
    await client.query('COMMIT');
    res.json({ ok: true, orcamentoId: v.orc_id, orcamentoNumero: v.orc_numero });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[vendas/cancelar-reabrir]', err);
    res.status(500).json({ error: 'Erro ao cancelar e reabrir orçamento.' });
  } finally {
    client.release();
  }
});

module.exports = router;
