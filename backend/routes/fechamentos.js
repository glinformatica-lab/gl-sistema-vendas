// ============================================
// FECHAMENTO MENSAL DAS PROFISSIONAIS
// v60: + total_bruto, total_custo_operacional_servicos,
//      total_comissao_servicos, total_custo_produtos_usados,
//      total_taxas_maquininha, total_lucro_salao
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

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
  for (const k in row) out[k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())] = row[k];
  return out;
}
function montar(row) {
  const obj = camelizar(row);
  if (obj.fechadoEm instanceof Date) obj.fechadoEm = obj.fechadoEm.toISOString();
  if (obj.pagoEm instanceof Date) obj.pagoEm = obj.pagoEm.toISOString().slice(0,10);
  return obj;
}
const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(num(v) * 100) / 100;

// ==========================================
// Função helper: calcula valores do mês pra 1 profissional
// ==========================================
async function calcularParaProf(empresaId, profissionalId, mes, ano) {
  const primeiro = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const proxMes = mes === 12 ? { m: 1, a: ano + 1 } : { m: mes + 1, a: ano };
  const primeiroProx = `${proxMes.a}-${String(proxMes.m).padStart(2,'0')}-01`;

  // Verifica se já existe fechamento
  const jaExiste = await db.query(
    `SELECT * FROM fechamentos_mensais
     WHERE empresa_id=$1 AND profissional_id=$2 AND mes=$3 AND ano=$4`,
    [empresaId, profissionalId, mes, ano]
  );

  // Busca atendimentos do período (só válidos) - inclui novos campos v59
  const atendQ = await db.query(
    `SELECT id, data, hora, cliente_nome,
            subtotal_servicos, subtotal_produtos, total_bruto,
            custo_produtos_usados, custo_operacional_servicos,
            total_taxas_maquininha,
            valor_espaco_salao, valor_comissao_profissional, valor_liquido_profissional, valor_liquido_salao,
            servicos, produtos_vendidos
     FROM atendimentos
     WHERE empresa_id=$1 AND profissional_id=$2
       AND cancelado = FALSE
       AND data >= $3 AND data < $4
     ORDER BY data, hora, id`,
    [empresaId, profissionalId, primeiro, primeiroProx]
  );

  // Busca vales do período
  const valesQ = await db.query(
    `SELECT id, data, valor, observacao, fechamento_id
     FROM vales_profissional
     WHERE empresa_id=$1 AND profissional_id=$2
       AND data >= $3 AND data < $4
     ORDER BY data, id`,
    [empresaId, profissionalId, primeiro, primeiroProx]
  );

  const atendimentos = atendQ.rows.map(a => ({
    id: a.id,
    data: a.data instanceof Date ? a.data.toISOString().slice(0,10) : String(a.data).slice(0,10),
    hora: a.hora ? String(a.hora).slice(0,5) : '',
    clienteNome: a.cliente_nome,
    subtotalServicos: num(a.subtotal_servicos),
    subtotalProdutos: num(a.subtotal_produtos),
    totalBruto: num(a.total_bruto),
    custoProdutosUsados: num(a.custo_produtos_usados),
    custoOperacionalServicos: num(a.custo_operacional_servicos),
    totalTaxasMaquininha: num(a.total_taxas_maquininha),
    valorEspacoSalao: num(a.valor_espaco_salao),
    valorComissaoProfissional: num(a.valor_comissao_profissional),
    valorLiquidoProfissional: num(a.valor_liquido_profissional),
    valorLiquidoSalao: num(a.valor_liquido_salao),
    servicos: typeof a.servicos === 'string' ? JSON.parse(a.servicos) : (a.servicos || []),
    produtosVendidos: typeof a.produtos_vendidos === 'string' ? JSON.parse(a.produtos_vendidos) : (a.produtos_vendidos || [])
  }));

  // ===== TOTAIS BÁSICOS =====
  const totalServicos           = round2(atendimentos.reduce((s, a) => s + a.subtotalServicos, 0));
  const totalProdutosVendidos   = round2(atendimentos.reduce((s, a) => s + a.subtotalProdutos, 0));
  const totalBruto              = round2(atendimentos.reduce((s, a) => s + a.totalBruto, 0));
  const totalTaxaEspaco         = round2(atendimentos.reduce((s, a) => s + a.valorEspacoSalao, 0));
  const totalCustoProdutosUsados = round2(atendimentos.reduce((s, a) => s + a.custoProdutosUsados, 0));
  const totalCustoOperacionalServicos = round2(atendimentos.reduce((s, a) => s + a.custoOperacionalServicos, 0));
  const totalTaxasMaquininha    = round2(atendimentos.reduce((s, a) => s + a.totalTaxasMaquininha, 0));

  // Comissão total da profissional (nos atendimentos, o campo valor_comissao_profissional = só comissão PRODUTOS)
  // valor_liquido_profissional = comissão serviços + comissão produtos
  // Então comissão serviços = valor_liquido - comissão produtos
  const totalComissaoProdutos = round2(atendimentos.reduce((s, a) => s + a.valorComissaoProfissional, 0));
  const totalLiquidoProfSum = round2(atendimentos.reduce((s, a) => s + a.valorLiquidoProfissional, 0));
  const totalComissaoServicos = round2(totalLiquidoProfSum - totalComissaoProdutos);

  // Lucro do salão total
  const totalLucroSalao = round2(atendimentos.reduce((s, a) => s + a.valorLiquidoSalao, 0));

  const vales = valesQ.rows.map(v => ({
    id: v.id,
    data: v.data instanceof Date ? v.data.toISOString().slice(0,10) : String(v.data).slice(0,10),
    valor: num(v.valor),
    observacao: v.observacao,
    fechamentoId: v.fechamento_id
  }));
  const totalVales = round2(vales.reduce((s, v) => s + v.valor, 0));

  // Valor líquido a receber pela profissional
  const valorLiquido = round2(totalComissaoServicos + totalComissaoProdutos - totalVales);

  return {
    qtdAtendimentos: atendimentos.length,
    totalBruto,
    totalServicos,
    totalProdutosVendidos,
    totalTaxaEspaco,
    totalCustoOperacionalServicos,
    totalCustoProdutosUsados,
    totalTaxasMaquininha,
    totalComissaoServicos,
    totalComissaoProdutos,
    totalLucroSalao,
    totalVales,
    valorLiquido,
    atendimentos,
    vales,
    fechamentoExistente: jaExiste.rows[0] ? camelizar(jaExiste.rows[0]) : null
  };
}

// ==========================================
// GET /calcular/:profId/:mes/:ano — Preview
// ==========================================
router.get('/calcular/:profId/:mes/:ano', async (req, res) => {
  try {
    const profId = parseInt(req.params.profId);
    const mes = parseInt(req.params.mes);
    const ano = parseInt(req.params.ano);
    if (!profId || mes < 1 || mes > 12 || ano < 2020) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    const p = await db.query(
      `SELECT id, nome, pix, percentual_espaco, percentual_comissao_produto, percentual_comissao_servico
       FROM profissionais WHERE id=$1 AND empresa_id=$2`,
      [profId, req.user.empresaId]
    );
    if (p.rows.length === 0) return res.status(404).json({ error: 'Profissional não encontrada.' });

    const calc = await calcularParaProf(req.user.empresaId, profId, mes, ano);
    res.json({
      profissional: camelizar(p.rows[0]),
      mes, ano,
      ...calc
    });
  } catch (err) {
    console.error('[fechamentos] GET /calcular', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /resumo/:mes/:ano — Resumo geral do mês
// ==========================================
router.get('/resumo/:mes/:ano', async (req, res) => {
  try {
    const mes = parseInt(req.params.mes);
    const ano = parseInt(req.params.ano);
    if (mes < 1 || mes > 12 || ano < 2020) return res.status(400).json({ error: 'Parâmetros inválidos.' });

    const profs = await db.query(
      'SELECT id, nome, ativo FROM profissionais WHERE empresa_id=$1 ORDER BY nome',
      [req.user.empresaId]
    );

    const resultado = [];
    for (const p of profs.rows) {
      const calc = await calcularParaProf(req.user.empresaId, p.id, mes, ano);
      if (calc.qtdAtendimentos > 0 || calc.totalVales > 0 || calc.fechamentoExistente) {

        const fech = calc.fechamentoExistente;
        let dadosMostrados;
        if (fech) {
          // Se ja existe snapshot, usa os valores travados
          dadosMostrados = {
            qtdAtendimentos: fech.qtdAtendimentos != null ? Number(fech.qtdAtendimentos) : calc.qtdAtendimentos,
            totalBruto: fech.totalBruto != null ? Number(fech.totalBruto) : calc.totalBruto,
            totalServicos: fech.totalServicos != null ? Number(fech.totalServicos) : calc.totalServicos,
            totalTaxaEspaco: fech.totalTaxaEspaco != null ? Number(fech.totalTaxaEspaco) : calc.totalTaxaEspaco,
            totalCustoOperacionalServicos: fech.totalCustoOperacionalServicos != null ? Number(fech.totalCustoOperacionalServicos) : calc.totalCustoOperacionalServicos,
            totalCustoProdutosUsados: fech.totalCustoProdutosUsados != null ? Number(fech.totalCustoProdutosUsados) : calc.totalCustoProdutosUsados,
            totalTaxasMaquininha: fech.totalTaxasMaquininha != null ? Number(fech.totalTaxasMaquininha) : calc.totalTaxasMaquininha,
            totalComissaoServicos: fech.totalComissaoServicos != null ? Number(fech.totalComissaoServicos) : calc.totalComissaoServicos,
            totalComissaoProdutos: fech.totalComissaoProdutos != null ? Number(fech.totalComissaoProdutos) : calc.totalComissaoProdutos,
            totalLucroSalao: fech.totalLucroSalao != null ? Number(fech.totalLucroSalao) : calc.totalLucroSalao,
            totalVales: fech.totalVales != null ? Number(fech.totalVales) : calc.totalVales,
            valorLiquido: fech.valorLiquido != null ? Number(fech.valorLiquido) : calc.valorLiquido
          };
        } else {
          dadosMostrados = {
            qtdAtendimentos: calc.qtdAtendimentos,
            totalBruto: calc.totalBruto,
            totalServicos: calc.totalServicos,
            totalTaxaEspaco: calc.totalTaxaEspaco,
            totalCustoOperacionalServicos: calc.totalCustoOperacionalServicos,
            totalCustoProdutosUsados: calc.totalCustoProdutosUsados,
            totalTaxasMaquininha: calc.totalTaxasMaquininha,
            totalComissaoServicos: calc.totalComissaoServicos,
            totalComissaoProdutos: calc.totalComissaoProdutos,
            totalLucroSalao: calc.totalLucroSalao,
            totalVales: calc.totalVales,
            valorLiquido: calc.valorLiquido
          };
        }

        resultado.push({
          profissionalId: p.id,
          profissionalNome: p.nome,
          ativo: p.ativo,
          ...dadosMostrados,
          fechamento: fech
        });
      }
    }
    res.json({ mes, ano, profissionais: resultado });
  } catch (err) {
    console.error('[fechamentos] GET /resumo', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /:id — Detalhe de um fechamento fechado
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fq = await db.query(
      `SELECT f.*, p.nome AS profissional_nome, p.pix AS profissional_pix,
              p.percentual_espaco, p.percentual_comissao_produto, p.percentual_comissao_servico
       FROM fechamentos_mensais f
       JOIN profissionais p ON p.id = f.profissional_id
       WHERE f.id=$1 AND f.empresa_id=$2`,
      [id, req.user.empresaId]
    );
    if (fq.rows.length === 0) return res.status(404).json({ error: 'Fechamento não encontrado.' });
    const f = fq.rows[0];

    const primeiro = `${f.ano}-${String(f.mes).padStart(2,'0')}-01`;
    const proxMes = f.mes === 12 ? { m: 1, a: f.ano + 1 } : { m: f.mes + 1, a: f.ano };
    const primeiroProx = `${proxMes.a}-${String(proxMes.m).padStart(2,'0')}-01`;
    const at = await db.query(
      `SELECT id, data, hora, cliente_nome, subtotal_servicos, subtotal_produtos, total_bruto,
              custo_produtos_usados, custo_operacional_servicos, total_taxas_maquininha,
              valor_espaco_salao, valor_comissao_profissional,
              valor_liquido_profissional, valor_liquido_salao,
              servicos, produtos_vendidos
       FROM atendimentos
       WHERE empresa_id=$1 AND profissional_id=$2
         AND cancelado=FALSE AND data >= $3 AND data < $4
       ORDER BY data, hora`,
      [req.user.empresaId, f.profissional_id, primeiro, primeiroProx]
    );
    const vales = await db.query(
      `SELECT id, data, valor, observacao FROM vales_profissional
       WHERE fechamento_id=$1 ORDER BY data`,
      [id]
    );

    res.json({
      fechamento: montar(f),
      atendimentos: at.rows.map(a => ({
        id: a.id,
        data: a.data instanceof Date ? a.data.toISOString().slice(0,10) : String(a.data).slice(0,10),
        hora: a.hora ? String(a.hora).slice(0,5) : '',
        clienteNome: a.cliente_nome,
        subtotalServicos: num(a.subtotal_servicos),
        subtotalProdutos: num(a.subtotal_produtos),
        totalBruto: num(a.total_bruto),
        custoProdutosUsados: num(a.custo_produtos_usados),
        custoOperacionalServicos: num(a.custo_operacional_servicos),
        totalTaxasMaquininha: num(a.total_taxas_maquininha),
        valorEspacoSalao: num(a.valor_espaco_salao),
        valorComissaoProfissional: num(a.valor_comissao_profissional),
        valorLiquidoProfissional: num(a.valor_liquido_profissional),
        valorLiquidoSalao: num(a.valor_liquido_salao),
        servicos: typeof a.servicos === 'string' ? JSON.parse(a.servicos) : (a.servicos || []),
        produtosVendidos: typeof a.produtos_vendidos === 'string' ? JSON.parse(a.produtos_vendidos) : (a.produtos_vendidos || [])
      })),
      vales: vales.rows.map(v => ({
        id: v.id,
        data: v.data instanceof Date ? v.data.toISOString().slice(0,10) : String(v.data).slice(0,10),
        valor: num(v.valor),
        observacao: v.observacao
      }))
    });
  } catch (err) {
    console.error('[fechamentos] GET /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST /gerar — Fecha o mês pra uma profissional
// ==========================================
router.post('/gerar', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { profissionalId, mes, ano, observacoes } = req.body || {};
    if (!profissionalId || !mes || !ano) return res.status(400).json({ error: 'Informe profissional, mês e ano.' });
    if (mes < 1 || mes > 12 || ano < 2020) return res.status(400).json({ error: 'Mês/ano inválidos.' });

    await client.query('BEGIN');

    const ex = await client.query(
      'SELECT id FROM fechamentos_mensais WHERE empresa_id=$1 AND profissional_id=$2 AND mes=$3 AND ano=$4',
      [req.user.empresaId, profissionalId, mes, ano]
    );
    if (ex.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Já existe fechamento pra esta profissional neste mês.' });
    }

    const calc = await calcularParaProf(req.user.empresaId, profissionalId, mes, ano);
    if (calc.qtdAtendimentos === 0 && calc.totalVales === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sem movimento no mês pra fechar.' });
    }

    const fIns = await client.query(
      `INSERT INTO fechamentos_mensais
         (empresa_id, profissional_id, mes, ano,
          qtd_atendimentos, total_servicos,
          total_bruto, total_custo_operacional_servicos,
          total_comissao_servicos, total_comissao_produtos,
          total_taxa_espaco, total_custo_produtos_usados,
          total_taxas_maquininha, total_lucro_salao,
          total_vales, valor_liquido,
          status, fechado_por, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'fechado',$17,$18)
       RETURNING *`,
      [
        req.user.empresaId, profissionalId, mes, ano,
        calc.qtdAtendimentos, calc.totalServicos,
        calc.totalBruto, calc.totalCustoOperacionalServicos,
        calc.totalComissaoServicos, calc.totalComissaoProdutos,
        calc.totalTaxaEspaco, calc.totalCustoProdutosUsados,
        calc.totalTaxasMaquininha, calc.totalLucroSalao,
        calc.totalVales, calc.valorLiquido,
        req.user.userId || null,
        observacoes || null
      ]
    );
    const fechamento = fIns.rows[0];

    if (calc.vales.length > 0) {
      const idsVales = calc.vales.map(v => v.id);
      await client.query(
        `UPDATE vales_profissional SET fechamento_id=$1
         WHERE id = ANY($2::int[]) AND empresa_id=$3`,
        [fechamento.id, idsVales, req.user.empresaId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(montar(fechamento));

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fechamentos] POST /gerar', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// POST /:id/marcar-pago
// ==========================================
router.post('/:id/marcar-pago', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { dataPagamento, formaPagamento, observacoes } = req.body || {};

    const chk = await db.query(
      'SELECT status FROM fechamentos_mensais WHERE id=$1 AND empresa_id=$2',
      [id, req.user.empresaId]
    );
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Fechamento não encontrado.' });
    if (chk.rows[0].status === 'pago') return res.status(400).json({ error: 'Já está marcado como pago.' });

    const r = await db.query(
      `UPDATE fechamentos_mensais
         SET status='pago', pago_em=$1, forma_pagamento=$2,
             observacoes = COALESCE(observacoes, '') || CASE WHEN $3::text IS NOT NULL AND $3::text != '' THEN E'\n[pago] ' || $3::text ELSE '' END
       WHERE id=$4 AND empresa_id=$5 RETURNING *`,
      [dataPagamento || new Date().toISOString().slice(0,10), formaPagamento || null, observacoes || null, id, req.user.empresaId]
    );
    res.json(montar(r.rows[0]));
  } catch (err) {
    console.error('[fechamentos] POST /:id/marcar-pago', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// DELETE /:id — Reabre fechamento
// ==========================================
router.delete('/:id', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const id = parseInt(req.params.id);
    await client.query('BEGIN');

    const chk = await client.query(
      'SELECT status FROM fechamentos_mensais WHERE id=$1 AND empresa_id=$2',
      [id, req.user.empresaId]
    );
    if (chk.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fechamento não encontrado.' });
    }
    if (chk.rows[0].status === 'pago') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fechamento já pago não pode ser reaberto.' });
    }

    await client.query(
      `UPDATE vales_profissional SET fechamento_id=NULL
       WHERE fechamento_id=$1 AND empresa_id=$2`,
      [id, req.user.empresaId]
    );
    await client.query('DELETE FROM fechamentos_mensais WHERE id=$1 AND empresa_id=$2', [id, req.user.empresaId]);

    await client.query('COMMIT');
    res.json({ ok: true, mensagem: 'Fechamento reaberto. Vales destrancados.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fechamentos] DELETE /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
