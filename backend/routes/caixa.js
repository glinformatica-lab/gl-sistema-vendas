const express = require('express');
const db = require('../db');
const router = express.Router();

const toNum = (v) => Number(v) || 0;

// Helper: calcula totais (vendas à vista + movimentos) de um caixa
async function calcularTotaisCaixa(caixaId, empresaId, data) {
  // Vendas à vista do dia (excluindo "A Prazo")
  // Soma todas as vendas registradas no dia desta empresa que não sejam a prazo
  const rVendas = await db.query(
    `SELECT pagamento, SUM(total) AS total, COUNT(*) AS qtd
     FROM vendas
     WHERE empresa_id=$1 AND data=$2 AND pagamento != 'A Prazo'
     GROUP BY pagamento`,
    [empresaId, data]
  );
  const vendasPorForma = {};
  let totalVendasVista = 0;
  let qtdVendas = 0;
  rVendas.rows.forEach(r => {
    const v = toNum(r.total);
    vendasPorForma[r.pagamento] = v;
    totalVendasVista += v;
    qtdVendas += parseInt(r.qtd, 10) || 0;
  });

  // Movimentos do caixa (reforço, sangria, despesa)
  const rMov = await db.query(
    `SELECT tipo, COALESCE(SUM(valor), 0) AS total, COUNT(*) AS qtd
     FROM caixa_movimentos
     WHERE caixa_id=$1
     GROUP BY tipo`,
    [caixaId]
  );
  const movPorTipo = { reforco: 0, sangria: 0, despesa: 0 };
  rMov.rows.forEach(r => { movPorTipo[r.tipo] = toNum(r.total); });

  return {
    vendasPorForma,
    totalVendasVista,
    qtdVendas,
    totalReforcos: movPorTipo.reforco,
    totalSangrias: movPorTipo.sangria,
    totalDespesas: movPorTipo.despesa
  };
}

// GET /api/caixa/atual — retorna o caixa de hoje (se aberto) com totais
router.get('/atual', async (req, res) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await db.query(
      `SELECT * FROM caixas WHERE empresa_id=$1 AND data=$2 LIMIT 1`,
      [req.user.empresaId, hoje]
    );
    if (r.rows.length === 0) return res.json({ caixa: null, hoje });
    const caixa = r.rows[0];
    const totais = await calcularTotaisCaixa(caixa.id, req.user.empresaId, hoje);
    const saldoEsperado = toNum(caixa.saldo_inicial) + totais.totalVendasVista + totais.totalReforcos - totais.totalSangrias - totais.totalDespesas;
    // Movimentos detalhados
    const rMov = await db.query(
      `SELECT cm.id, cm.tipo, cm.valor, cm.descricao, cm.categoria, cm.criado_em, u.nome AS usuario
       FROM caixa_movimentos cm LEFT JOIN usuarios u ON u.id = cm.criado_por
       WHERE cm.caixa_id=$1 ORDER BY cm.criado_em DESC`,
      [caixa.id]
    );
    res.json({
      caixa: {
        id: caixa.id,
        data: caixa.data instanceof Date ? caixa.data.toISOString().slice(0,10) : caixa.data,
        saldoInicial: toNum(caixa.saldo_inicial),
        status: caixa.status,
        saldoFinalInformado: caixa.saldo_final_informado != null ? toNum(caixa.saldo_final_informado) : null,
        obs: caixa.obs,
        abertoEm: caixa.aberto_em,
        fechadoEm: caixa.fechado_em
      },
      totais,
      saldoEsperado,
      diferenca: caixa.saldo_final_informado != null ? toNum(caixa.saldo_final_informado) - saldoEsperado : null,
      movimentos: rMov.rows.map(m => ({
        id: m.id,
        tipo: m.tipo,
        valor: toNum(m.valor),
        descricao: m.descricao,
        categoria: m.categoria,
        criadoEm: m.criado_em,
        usuario: m.usuario
      })),
      hoje
    });
  } catch (err) {
    console.error('[caixa/atual]', err);
    res.status(500).json({ error: 'Erro ao carregar caixa atual.' });
  }
});

// POST /api/caixa/abrir — abre caixa do dia com saldo inicial
router.post('/abrir', async (req, res) => {
  const { saldoInicial } = req.body || {};
  const valor = toNum(saldoInicial);
  if (valor < 0) return res.status(400).json({ error: 'Saldo inicial não pode ser negativo.' });
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const existente = await db.query(
      `SELECT id, status FROM caixas WHERE empresa_id=$1 AND data=$2`,
      [req.user.empresaId, hoje]
    );
    if (existente.rows.length > 0) {
      return res.status(400).json({ error: 'Já existe um caixa para hoje.' });
    }
    const r = await db.query(
      `INSERT INTO caixas (empresa_id, data, saldo_inicial, status, aberto_por)
       VALUES ($1, $2, $3, 'aberto', $4) RETURNING *`,
      [req.user.empresaId, hoje, valor, req.user.userId]
    );
    res.json({ ok: true, caixa: r.rows[0] });
  } catch (err) {
    console.error('[caixa/abrir]', err);
    res.status(500).json({ error: 'Erro ao abrir caixa.' });
  }
});

// POST /api/caixa/movimentos — registra reforço, sangria ou despesa
router.post('/movimentos', async (req, res) => {
  const { tipo, valor, descricao, categoria } = req.body || {};
  if (!['reforco', 'sangria', 'despesa'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido. Use: reforco, sangria ou despesa.' });
  }
  const valorNum = toNum(valor);
  if (valorNum <= 0) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });
  if (!descricao || !descricao.trim()) return res.status(400).json({ error: 'Descrição é obrigatória.' });
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const rCaixa = await db.query(
      `SELECT id, status FROM caixas WHERE empresa_id=$1 AND data=$2`,
      [req.user.empresaId, hoje]
    );
    if (rCaixa.rows.length === 0) return res.status(400).json({ error: 'Caixa de hoje não está aberto. Abra o caixa primeiro.' });
    if (rCaixa.rows[0].status === 'fechado') return res.status(400).json({ error: 'Caixa de hoje já foi fechado. Não é possível adicionar movimentos.' });
    await db.query(
      `INSERT INTO caixa_movimentos (empresa_id, caixa_id, tipo, valor, descricao, categoria, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.empresaId, rCaixa.rows[0].id, tipo, valorNum, descricao.trim(), categoria || null, req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[caixa/movimentos]', err);
    res.status(500).json({ error: 'Erro ao registrar movimento.' });
  }
});

// DELETE /api/caixa/movimentos/:id — exclui movimento (só se caixa aberto)
router.delete('/movimentos/:id', async (req, res) => {
  try {
    const r = await db.query(
      `DELETE FROM caixa_movimentos cm
       WHERE cm.id=$1 AND cm.empresa_id=$2
         AND cm.caixa_id IN (SELECT id FROM caixas WHERE id = cm.caixa_id AND status = 'aberto')
       RETURNING id`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Movimento não encontrado ou caixa já fechado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[caixa/movimentos/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir movimento.' });
  }
});

// POST /api/caixa/fechar — fecha o caixa do dia
router.post('/fechar', async (req, res) => {
  const { saldoFinalInformado, obs } = req.body || {};
  const saldoFinal = toNum(saldoFinalInformado);
  if (saldoFinal < 0) return res.status(400).json({ error: 'Saldo final não pode ser negativo.' });
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const rCaixa = await db.query(
      `SELECT * FROM caixas WHERE empresa_id=$1 AND data=$2`,
      [req.user.empresaId, hoje]
    );
    if (rCaixa.rows.length === 0) return res.status(400).json({ error: 'Não há caixa aberto hoje.' });
    if (rCaixa.rows[0].status === 'fechado') return res.status(400).json({ error: 'Caixa já está fechado.' });
    await db.query(
      `UPDATE caixas SET status='fechado', saldo_final_informado=$1, obs=$2,
              fechado_por=$3, fechado_em=NOW() WHERE id=$4`,
      [saldoFinal, obs || null, req.user.userId, rCaixa.rows[0].id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[caixa/fechar]', err);
    res.status(500).json({ error: 'Erro ao fechar caixa.' });
  }
});

// POST /api/caixa/reabrir — reabre o caixa (só admin)
router.post('/reabrir', async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores podem reabrir o caixa.' });
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await db.query(
      `UPDATE caixas SET status='aberto', saldo_final_informado=NULL, obs=NULL, fechado_em=NULL, fechado_por=NULL
       WHERE empresa_id=$1 AND data=$2 RETURNING id`,
      [req.user.empresaId, hoje]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Caixa de hoje não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[caixa/reabrir]', err);
    res.status(500).json({ error: 'Erro ao reabrir caixa.' });
  }
});

// GET /api/caixa/historico?ano=YYYY&mes=MM — lista caixas fechados
router.get('/historico', async (req, res) => {
  try {
    const ano = parseInt(req.query.ano, 10) || new Date().getFullYear();
    const mes = parseInt(req.query.mes, 10) || (new Date().getMonth() + 1);
    const inicio = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = new Date(ano, mes, 0).toISOString().slice(0,10); // último dia do mês
    const r = await db.query(
      `SELECT id, data, saldo_inicial, status, saldo_final_informado, obs
       FROM caixas
       WHERE empresa_id=$1 AND data BETWEEN $2 AND $3
       ORDER BY data DESC`,
      [req.user.empresaId, inicio, fim]
    );
    // Para cada caixa, calcula totais resumidos
    const resultado = [];
    for (const c of r.rows) {
      const dataIso = c.data instanceof Date ? c.data.toISOString().slice(0,10) : c.data;
      const totais = await calcularTotaisCaixa(c.id, req.user.empresaId, dataIso);
      const saldoEsperado = toNum(c.saldo_inicial) + totais.totalVendasVista + totais.totalReforcos - totais.totalSangrias - totais.totalDespesas;
      resultado.push({
        id: c.id,
        data: dataIso,
        status: c.status,
        saldoInicial: toNum(c.saldo_inicial),
        totalVendasVista: totais.totalVendasVista,
        qtdVendas: totais.qtdVendas,
        totalReforcos: totais.totalReforcos,
        totalSangrias: totais.totalSangrias,
        totalDespesas: totais.totalDespesas,
        saldoEsperado,
        saldoFinalInformado: c.saldo_final_informado != null ? toNum(c.saldo_final_informado) : null,
        diferenca: c.saldo_final_informado != null ? toNum(c.saldo_final_informado) - saldoEsperado : null,
        obs: c.obs
      });
    }
    res.json(resultado);
  } catch (err) {
    console.error('[caixa/historico]', err);
    res.status(500).json({ error: 'Erro ao carregar histórico.' });
  }
});

// GET /api/caixa/:id — detalhes de um caixa específico (com movimentos)
router.get('/:id', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM caixas WHERE id=$1 AND empresa_id=$2`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Caixa não encontrado.' });
    const caixa = r.rows[0];
    const dataIso = caixa.data instanceof Date ? caixa.data.toISOString().slice(0,10) : caixa.data;
    const totais = await calcularTotaisCaixa(caixa.id, req.user.empresaId, dataIso);
    const saldoEsperado = toNum(caixa.saldo_inicial) + totais.totalVendasVista + totais.totalReforcos - totais.totalSangrias - totais.totalDespesas;
    const rMov = await db.query(
      `SELECT cm.id, cm.tipo, cm.valor, cm.descricao, cm.categoria, cm.criado_em, u.nome AS usuario
       FROM caixa_movimentos cm LEFT JOIN usuarios u ON u.id = cm.criado_por
       WHERE cm.caixa_id=$1 ORDER BY cm.criado_em DESC`,
      [caixa.id]
    );
    // Vendas detalhadas
    const rVendas = await db.query(
      `SELECT id, cliente, total, pagamento FROM vendas
       WHERE empresa_id=$1 AND data=$2 AND pagamento != 'A Prazo'
       ORDER BY id`,
      [req.user.empresaId, dataIso]
    );
    res.json({
      caixa: {
        id: caixa.id,
        data: dataIso,
        saldoInicial: toNum(caixa.saldo_inicial),
        status: caixa.status,
        saldoFinalInformado: caixa.saldo_final_informado != null ? toNum(caixa.saldo_final_informado) : null,
        obs: caixa.obs,
        abertoEm: caixa.aberto_em,
        fechadoEm: caixa.fechado_em
      },
      totais,
      saldoEsperado,
      diferenca: caixa.saldo_final_informado != null ? toNum(caixa.saldo_final_informado) - saldoEsperado : null,
      movimentos: rMov.rows.map(m => ({
        id: m.id, tipo: m.tipo, valor: toNum(m.valor), descricao: m.descricao,
        categoria: m.categoria, criadoEm: m.criado_em, usuario: m.usuario
      })),
      vendas: rVendas.rows.map(v => ({
        id: v.id, cliente: v.cliente, total: toNum(v.total), pagamento: v.pagamento
      }))
    });
  } catch (err) {
    console.error('[caixa/get]', err);
    res.status(500).json({ error: 'Erro ao carregar caixa.' });
  }
});

module.exports = router;
