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
    parcelas.push({ numero: i + 1, total: n, valor, vencimento: d.toISOString().slice(0, 10) });
  }
  return parcelas;
}

router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM contas_pagar WHERE empresa_id=$1 ORDER BY vencimento, id',
      [req.user.empresaId]
    );
    res.json(r.rows.map(c => ({ ...camelizar(c), valor: toNum(c.valor) })));
  } catch (err) {
    console.error('[contas-pagar/list]', err);
    res.status(500).json({ error: 'Erro ao listar contas a pagar.' });
  }
});

// Lançamento manual (1 ou várias parcelas) — fornecedor opcional
router.post('/', async (req, res) => {
  const { fornecedor, descricao, categoria, valor, vencimento, nParcelas, intervalo, obs } = req.body || {};
  if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória.' });
  if (!valor || valor <= 0) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });
  if (!vencimento) return res.status(400).json({ error: 'Data de vencimento é obrigatória.' });
  const n = Math.max(1, parseInt(nParcelas) || 1);
  const inter = Math.max(1, parseInt(intervalo) || 30);
  try {
    const parcelas = calcularParcelas(Number(valor), n, vencimento, inter);
    const descBase = categoria ? `${categoria} - ${descricao}` : descricao;
    const inseridas = [];
    for (const p of parcelas) {
      const desc = n > 1 ? `${descBase} (${p.numero}/${p.total})` : descBase;
      const r = await db.query(
        `INSERT INTO contas_pagar (empresa_id, fornecedor, descricao, categoria, valor, vencimento, status, origem, obs)
         VALUES ($1,$2,$3,$4,$5,$6,'Pendente','manual',$7) RETURNING *`,
        [req.user.empresaId, fornecedor || null, desc, categoria || null, p.valor, p.vencimento, obs || null]
      );
      inseridas.push({ ...camelizar(r.rows[0]), valor: toNum(r.rows[0].valor) });
    }
    res.json({ ok: true, contas: inseridas });
  } catch (err) {
    console.error('[contas-pagar/create]', err);
    res.status(500).json({ error: 'Erro ao lançar conta.' });
  }
});

// Editar (apenas manuais)
router.put('/:id', async (req, res) => {
  const { fornecedor, descricao, categoria, valor, vencimento, obs } = req.body || {};
  if (!descricao || !valor || !vencimento) return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
  try {
    const c = await db.query('SELECT * FROM contas_pagar WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
    if (c.rows[0].entrada_id) return res.status(400).json({ error: 'Conta vinculada a uma entrada não pode ser editada aqui.' });
    const r = await db.query(
      `UPDATE contas_pagar SET fornecedor=$1, descricao=$2, categoria=$3, valor=$4, vencimento=$5, obs=$6
       WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [fornecedor || null, descricao, categoria || null, Number(valor), vencimento, obs || null,
       req.params.id, req.user.empresaId]
    );
    res.json({ ...camelizar(r.rows[0]), valor: toNum(r.rows[0].valor) });
  } catch (err) {
    console.error('[contas-pagar/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar conta.' });
  }
});

// Quitar
router.post('/:id/quitar', async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE contas_pagar SET status='Paga', data_pagamento=COALESCE(data_pagamento, CURRENT_DATE)
       WHERE id=$1 AND empresa_id=$2 RETURNING *`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
    res.json({ ...camelizar(r.rows[0]), valor: toNum(r.rows[0].valor) });
  } catch (err) {
    console.error('[contas-pagar/quitar]', err);
    res.status(500).json({ error: 'Erro ao quitar conta.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const c = await db.query('SELECT entrada_id FROM contas_pagar WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
    if (c.rows[0].entrada_id) return res.status(400).json({ error: 'Conta vinculada a uma entrada não pode ser excluída.' });
    await db.query('DELETE FROM contas_pagar WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[contas-pagar/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir conta.' });
  }
});

module.exports = router;
