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
      'SELECT * FROM contas_receber WHERE empresa_id=$1 ORDER BY vencimento, id',
      [req.user.empresaId]
    );
    res.json(r.rows.map(c => ({ ...camelizar(c), valor: toNum(c.valor) })));
  } catch (err) {
    console.error('[contas-receber/list]', err);
    res.status(500).json({ error: 'Erro ao listar contas a receber.' });
  }
});

router.post('/', async (req, res) => {
  const { cliente, descricao, categoria, valor, vencimento, nParcelas, intervalo, obs } = req.body || {};
  if (!cliente) return res.status(400).json({ error: 'Cliente é obrigatório.' });
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
        `INSERT INTO contas_receber (empresa_id, cliente, descricao, categoria, valor, vencimento, status, origem, obs)
         VALUES ($1,$2,$3,$4,$5,$6,'Pendente','manual',$7) RETURNING *`,
        [req.user.empresaId, cliente, desc, categoria || null, p.valor, p.vencimento, obs || null]
      );
      inseridas.push({ ...camelizar(r.rows[0]), valor: toNum(r.rows[0].valor) });
    }
    res.json({ ok: true, contas: inseridas });
  } catch (err) {
    console.error('[contas-receber/create]', err);
    res.status(500).json({ error: 'Erro ao lançar conta.' });
  }
});

router.put('/:id', async (req, res) => {
  const { cliente, descricao, categoria, valor, vencimento, obs } = req.body || {};
  if (!cliente || !descricao || !valor || !vencimento) return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
  try {
    const c = await db.query('SELECT * FROM contas_receber WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
    if (c.rows[0].venda_id) return res.status(400).json({ error: 'Conta vinculada a uma venda não pode ser editada aqui.' });
    const r = await db.query(
      `UPDATE contas_receber SET cliente=$1, descricao=$2, categoria=$3, valor=$4, vencimento=$5, obs=$6
       WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [cliente, descricao, categoria || null, Number(valor), vencimento, obs || null,
       req.params.id, req.user.empresaId]
    );
    res.json({ ...camelizar(r.rows[0]), valor: toNum(r.rows[0].valor) });
  } catch (err) {
    console.error('[contas-receber/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar conta.' });
  }
});

router.post('/:id/receber', async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE contas_receber SET status='Recebida', data_recebimento=COALESCE(data_recebimento, CURRENT_DATE)
       WHERE id=$1 AND empresa_id=$2 RETURNING *`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
    res.json({ ...camelizar(r.rows[0]), valor: toNum(r.rows[0].valor) });
  } catch (err) {
    console.error('[contas-receber/receber]', err);
    res.status(500).json({ error: 'Erro ao receber.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const c = await db.query('SELECT venda_id FROM contas_receber WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
    if (c.rows[0].venda_id) return res.status(400).json({ error: 'Conta vinculada a uma venda não pode ser excluída.' });
    await db.query('DELETE FROM contas_receber WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[contas-receber/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir conta.' });
  }
});

module.exports = router;
