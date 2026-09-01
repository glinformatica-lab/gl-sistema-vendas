// ============================================
// ATENDIMENTOS DO SALÃO
// Coração do sistema: registra venda de serviço + produto,
// calcula automaticamente comissão/espaço/taxa/divisão de valores
// e dá baixa em estoque nos produtos usados.
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware
async function requerSalao(req, res, next) {
  try {
    const r = await db.query('SELECT modulo_salao FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.modulo_salao) {
      return res.status(403).json({ error: 'Feature disponível apenas com Módulo Salão.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
}
router.use(requerSalao);

function camelizar(row) {
  const out = {};
  for (const k in row) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    out[camel] = row[k];
  }
  return out;
}

function montar(row) {
  const obj = camelizar(row);
  if (obj.data instanceof Date) obj.data = obj.data.toISOString().slice(0, 10);
  if (obj.hora && typeof obj.hora === 'string') obj.hora = obj.hora.slice(0, 5);
  ['servicos','produtosVendidos','produtosUsados','pagamentos'].forEach(k => {
    if (typeof obj[k] === 'string') { try { obj[k] = JSON.parse(obj[k]); } catch(e) {} }
    if (!obj[k]) obj[k] = [];
  });
  return obj;
}

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(num(v) * 100) / 100;

// ==========================================
// GET /faturamento — Cards de dashboard (hoje + mês)
// ==========================================
router.get('/faturamento', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
         COALESCE(SUM(total_bruto) FILTER (WHERE data = CURRENT_DATE), 0) AS bruto_hoje,
         COUNT(*) FILTER (WHERE data = CURRENT_DATE)::int AS qtd_hoje,
         COALESCE(SUM(total_bruto) FILTER (WHERE date_trunc('month', data) = date_trunc('month', CURRENT_DATE)), 0) AS bruto_mes,
         COUNT(*) FILTER (WHERE date_trunc('month', data) = date_trunc('month', CURRENT_DATE))::int AS qtd_mes
       FROM atendimentos
       WHERE empresa_id = $1 AND cancelado = FALSE`,
      [req.user.empresaId]
    );
    const row = r.rows[0];
    res.json({
      brutoHoje: Number(row.bruto_hoje) || 0,
      qtdHoje: row.qtd_hoje,
      brutoMes: Number(row.bruto_mes) || 0,
      qtdMes: row.qtd_mes
    });
  } catch (err) {
    console.error('[atendimentos] GET /faturamento', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET / — Lista atendimentos
// Query params: ?de=&ate=&profissionalId=&clienteId=&incluirCancelados=
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { de, ate, profissionalId, clienteId, incluirCancelados } = req.query;
    const where = ['a.empresa_id = $1'];
    const vals = [req.user.empresaId];
    let idx = 2;

    if (incluirCancelados !== 'true') where.push('a.cancelado = FALSE');
    if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) { where.push(`a.data >= $${idx++}`); vals.push(de); }
    if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) { where.push(`a.data <= $${idx++}`); vals.push(ate); }
    if (profissionalId) { where.push(`a.profissional_id = $${idx++}`); vals.push(parseInt(profissionalId)); }
    if (clienteId) { where.push(`a.cliente_id = $${idx++}`); vals.push(parseInt(clienteId)); }

    const r = await db.query(
      `SELECT a.*, p.nome AS profissional_nome
       FROM atendimentos a
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.data DESC, a.hora DESC, a.id DESC
       LIMIT 500`,
      vals
    );
    res.json(r.rows.map(montar));
  } catch (err) {
    console.error('[atendimentos] GET /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /:id — Detalhe
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const r = await db.query(
      `SELECT a.*, p.nome AS profissional_nome
       FROM atendimentos a
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.id = $1 AND a.empresa_id = $2`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Atendimento não encontrado.' });
    res.json(montar(r.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST / — Novo atendimento
// Calcula automaticamente e dá baixa em estoque
// ==========================================
router.post('/', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      agendamentoId,
      profissionalId,
      clienteId, clienteNome, clienteTelefone,
      data, hora,
      servicos,           // [{servicoId, nome, preco}]
      produtosVendidos,   // [{produtoId, nome, qtd, precoUnit, comissaoPct}]
      produtosUsados,     // [{produtoId, nome, qtd, custoUnit, baixarEstoque}]
      desconto,
      pagamentos,         // [{formaPagamento, valor}]
      observacoes
    } = req.body || {};

    // Validações mínimas
    if (!profissionalId) return res.status(400).json({ error: 'Profissional é obrigatório.' });
    if (!clienteNome || !clienteNome.trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
    const listaServ = Array.isArray(servicos) ? servicos : [];
    const listaProdV = Array.isArray(produtosVendidos) ? produtosVendidos : [];
    if (listaServ.length === 0 && listaProdV.length === 0) {
      return res.status(400).json({ error: 'Informe pelo menos um serviço ou produto vendido.' });
    }

    await client.query('BEGIN');

    // Busca % da profissional
    const profQ = await client.query(
      'SELECT percentual_espaco, percentual_comissao_produto FROM profissionais WHERE id=$1 AND empresa_id=$2',
      [profissionalId, req.user.empresaId]
    );
    if (profQ.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Profissional inválida.' });
    }
    const pctEspaco = num(profQ.rows[0].percentual_espaco);
    const pctComissaoPadrao = num(profQ.rows[0].percentual_comissao_produto);

    // Busca taxas configuradas
    const taxasQ = await client.query(
      'SELECT forma_pagamento, taxa_percentual FROM taxas_maquininha WHERE empresa_id=$1',
      [req.user.empresaId]
    );
    const taxaMap = {};
    taxasQ.rows.forEach(t => { taxaMap[t.forma_pagamento] = num(t.taxa_percentual); });

    // ===== CALCULA VALORES =====

    // Serviços
    const servicosLimpos = listaServ.map(s => ({
      servicoId: s.servicoId || null,
      nome: s.nome || '',
      preco: round2(s.preco)
    }));
    const subtotalServicos = round2(servicosLimpos.reduce((sum, s) => sum + s.preco, 0));

    // Produtos vendidos (calcula comissão da profissional por item)
    const produtosVendidosLimpos = listaProdV.map(p => {
      const qtd = num(p.qtd);
      const precoUnit = round2(p.precoUnit);
      const subtotal = round2(qtd * precoUnit);
      const comissaoPct = p.comissaoPct != null ? num(p.comissaoPct) : pctComissaoPadrao;
      const comissaoValor = round2(subtotal * comissaoPct / 100);
      return {
        produtoId: p.produtoId || null,
        nome: p.nome || '',
        qtd, precoUnit, subtotal, comissaoPct, comissaoValor
      };
    });
    const subtotalProdutos = round2(produtosVendidosLimpos.reduce((sum, p) => sum + p.subtotal, 0));
    const valorComissaoProf = round2(produtosVendidosLimpos.reduce((sum, p) => sum + p.comissaoValor, 0));

    // Produtos usados (custo interno)
    const produtosUsadosLimpos = (Array.isArray(produtosUsados) ? produtosUsados : []).map(p => {
      const qtd = num(p.qtd);
      const custoUnit = round2(p.custoUnit);
      return {
        produtoId: p.produtoId || null,
        nome: p.nome || '',
        qtd,
        custoUnit,
        custoTotal: round2(qtd * custoUnit),
        baixarEstoque: p.baixarEstoque !== false // default true
      };
    });
    const custoProdUsados = round2(produtosUsadosLimpos.reduce((sum, p) => sum + p.custoTotal, 0));

    // Totais
    const descontoNum = round2(desconto);
    const totalBruto = round2(subtotalServicos + subtotalProdutos - descontoNum);

    // Pagamentos: aplica taxa configurada de cada forma
    const listaPag = Array.isArray(pagamentos) ? pagamentos : [];
    if (listaPag.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Informe pelo menos uma forma de pagamento.' });
    }
    const pagamentosLimpos = listaPag.map(p => {
      const valor = round2(p.valor);
      const taxaPct = taxaMap[p.formaPagamento] || 0;
      const taxaValor = round2(valor * taxaPct / 100);
      return {
        formaPagamento: p.formaPagamento,
        valor,
        taxaPct,
        taxaValor,
        valorLiquido: round2(valor - taxaValor)
      };
    });
    const somaPagamentos = round2(pagamentosLimpos.reduce((s, p) => s + p.valor, 0));
    // Tolerância de 1 centavo
    if (Math.abs(somaPagamentos - totalBruto) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Soma dos pagamentos (R$ ${somaPagamentos.toFixed(2)}) não bate com o total (R$ ${totalBruto.toFixed(2)}).`
      });
    }
    const totalTaxas = round2(pagamentosLimpos.reduce((s, p) => s + p.taxaValor, 0));
    const totalLiquido = round2(totalBruto - totalTaxas);

    // Divisão salão × profissional
    // Profissional ganha: serviços - taxa espaço + comissão de produtos vendidos
    // Salão fica com: taxa espaço + (produtos - comissão prof) - taxas maquininha
    // (nesta versão simples, taxa maquininha é integralmente do salão)
    const valorEspacoSalao = round2(subtotalServicos * pctEspaco / 100);
    const valorLiquidoProf = round2(subtotalServicos - valorEspacoSalao + valorComissaoProf);
    const valorLiquidoSalao = round2(valorEspacoSalao + subtotalProdutos - valorComissaoProf - totalTaxas - descontoNum);

    // ===== INSERE NO BANCO =====

    const insertQ = await client.query(
      `INSERT INTO atendimentos
        (empresa_id, agendamento_id, profissional_id,
         cliente_id, cliente_nome, cliente_telefone,
         data, hora,
         servicos, subtotal_servicos,
         produtos_vendidos, subtotal_produtos,
         produtos_usados, custo_produtos_usados,
         desconto, total_bruto,
         pagamentos, total_taxas_maquininha, total_liquido,
         valor_espaco_salao, valor_comissao_profissional,
         valor_liquido_profissional, valor_liquido_salao,
         observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        req.user.empresaId,
        agendamentoId ? parseInt(agendamentoId) : null,
        parseInt(profissionalId),
        clienteId ? parseInt(clienteId) : null,
        clienteNome.trim(),
        clienteTelefone || null,
        data || null,   // se null, banco usa CURRENT_DATE
        hora || null,   // se null, banco usa CURRENT_TIME
        JSON.stringify(servicosLimpos),
        subtotalServicos,
        JSON.stringify(produtosVendidosLimpos),
        subtotalProdutos,
        JSON.stringify(produtosUsadosLimpos),
        custoProdUsados,
        descontoNum,
        totalBruto,
        JSON.stringify(pagamentosLimpos),
        totalTaxas,
        totalLiquido,
        valorEspacoSalao,
        valorComissaoProf,
        valorLiquidoProf,
        valorLiquidoSalao,
        observacoes || null,
        req.user.userId || null
      ]
    );
    const atendimento = insertQ.rows[0];

    // ===== BAIXA EM ESTOQUE =====
    // Produtos vendidos (todos dão baixa) + Produtos usados (só os marcados)
    const baixas = [];
    for (const p of produtosVendidosLimpos) {
      if (p.produtoId) baixas.push({ produtoId: p.produtoId, qtd: p.qtd });
    }
    for (const p of produtosUsadosLimpos) {
      if (p.produtoId && p.baixarEstoque) baixas.push({ produtoId: p.produtoId, qtd: p.qtd });
    }
    for (const b of baixas) {
      await client.query(
        `UPDATE produtos SET estoque = COALESCE(estoque, 0) - $1
         WHERE id = $2 AND empresa_id = $3`,
        [b.qtd, b.produtoId, req.user.empresaId]
      );
    }

    // ===== MARCA AGENDAMENTO COMO ATENDIDO =====
    if (agendamentoId) {
      await client.query(
        `UPDATE agendamentos
         SET status = 'atendido', atendimento_id = $1, atualizado_em = NOW()
         WHERE id = $2 AND empresa_id = $3`,
        [atendimento.id, parseInt(agendamentoId), req.user.empresaId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(montar(atendimento));

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[atendimentos] POST /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/cancelar — Cancela (soft delete) e ESTORNA estoque
// ==========================================
router.post('/:id/cancelar', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const id = parseInt(req.params.id);
    const { motivo } = req.body || {};

    await client.query('BEGIN');

    const at = await client.query(
      'SELECT * FROM atendimentos WHERE id=$1 AND empresa_id=$2',
      [id, req.user.empresaId]
    );
    if (at.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Atendimento não encontrado.' });
    }
    if (at.rows[0].cancelado) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Atendimento já está cancelado.' });
    }
    const atendimento = at.rows[0];

    // Marca como cancelado
    await client.query(
      `UPDATE atendimentos SET cancelado=TRUE, cancelado_em=NOW(), cancelado_motivo=$1
       WHERE id=$2 AND empresa_id=$3`,
      [motivo || null, id, req.user.empresaId]
    );

    // Estorna estoque
    const prodV = typeof atendimento.produtos_vendidos === 'string'
      ? JSON.parse(atendimento.produtos_vendidos)
      : (atendimento.produtos_vendidos || []);
    const prodU = typeof atendimento.produtos_usados === 'string'
      ? JSON.parse(atendimento.produtos_usados)
      : (atendimento.produtos_usados || []);

    for (const p of prodV) {
      if (p.produtoId) {
        await client.query(
          `UPDATE produtos SET estoque = COALESCE(estoque, 0) + $1
           WHERE id = $2 AND empresa_id = $3`,
          [p.qtd, p.produtoId, req.user.empresaId]
        );
      }
    }
    for (const p of prodU) {
      if (p.produtoId && p.baixarEstoque) {
        await client.query(
          `UPDATE produtos SET estoque = COALESCE(estoque, 0) + $1
           WHERE id = $2 AND empresa_id = $3`,
          [p.qtd, p.produtoId, req.user.empresaId]
        );
      }
    }

    // Se veio de agendamento, volta pra 'agendado'
    if (atendimento.agendamento_id) {
      await client.query(
        `UPDATE agendamentos SET status='agendado', atendimento_id=NULL, atualizado_em=NOW()
         WHERE id=$1 AND empresa_id=$2`,
        [atendimento.agendamento_id, req.user.empresaId]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, mensagem: 'Atendimento cancelado e estoque estornado.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[atendimentos] cancelar', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
