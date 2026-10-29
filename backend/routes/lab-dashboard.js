const express = require('express');
const db = require('../db');
const router = express.Router();

const toNum = (v) => (v == null ? 0 : Number(v));

router.get('/', async (req, res) => {
  const empresaId = req.user.empresaId;
  try {
    const rAtMes = await db.query(
      `SELECT COALESCE(SUM(valor_total),0) AS total, COUNT(*)::int AS qtd
       FROM lab_atendimentos
       WHERE empresa_id = $1 AND date_trunc('month', data) = date_trunc('month', CURRENT_DATE)`,
      [empresaId]
    );
    const rAtHoje = await db.query(
      `SELECT COALESCE(SUM(valor_total),0) AS total, COUNT(*)::int AS qtd
       FROM lab_atendimentos
       WHERE empresa_id = $1 AND data = CURRENT_DATE`,
      [empresaId]
    );
    const rCP = await db.query(
      `SELECT COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS qtd
       FROM contas_pagar
       WHERE empresa_id = $1
         AND date_trunc('month', vencimento) = date_trunc('month', CURRENT_DATE)
         AND status = 'Pendente'`,
      [empresaId]
    );
    const rCR = await db.query(
      `SELECT COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS qtd
       FROM contas_receber
       WHERE empresa_id = $1
         AND date_trunc('month', vencimento) = date_trunc('month', CURRENT_DATE)
         AND status = 'Pendente'`,
      [empresaId]
    );
    const rEst = await db.query(
      `SELECT id, codigo, nome, estoque, estoque_minimo
       FROM produtos
       WHERE empresa_id = $1
         AND estoque_minimo > 0
         AND estoque < estoque_minimo
       ORDER BY (estoque_minimo - estoque) DESC
       LIMIT 10`,
      [empresaId]
    );
    const rVal = await db.query(
      `SELECT id, codigo, nome, validade,
              (validade - CURRENT_DATE) AS dias_pra_vencer
       FROM produtos
       WHERE empresa_id = $1
         AND validade IS NOT NULL
         AND validade <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY validade ASC
       LIMIT 10`,
      [empresaId]
    );

    res.json({
      receitaMes: toNum(rAtMes.rows[0].total),
      qtdAtendimentosMes: rAtMes.rows[0].qtd,
      receitaHoje: toNum(rAtHoje.rows[0].total),
      qtdAtendimentosHoje: rAtHoje.rows[0].qtd,
      contasPagarMes: { total: toNum(rCP.rows[0].total), qtd: rCP.rows[0].qtd },
      contasReceberMes: { total: toNum(rCR.rows[0].total), qtd: rCR.rows[0].qtd },
      estoqueBaixo: rEst.rows.map(p => ({
        id: p.id, codigo: p.codigo, nome: p.nome,
        estoque: toNum(p.estoque),
        estoqueMinimo: toNum(p.estoque_minimo)
      })),
      vencendoLogo: rVal.rows.map(p => ({
        id: p.id, codigo: p.codigo, nome: p.nome,
        validade: p.validade,
        diasPraVencer: p.dias_pra_vencer
      }))
    });
  } catch (err) {
    console.error('[lab-dashboard]', err);
    res.status(500).json({ error: 'Erro ao carregar dashboard: ' + err.message });
  }
});

module.exports = router;
