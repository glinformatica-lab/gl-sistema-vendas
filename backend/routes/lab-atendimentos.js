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
const formatarDataIso = (d) => {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10);
};

// Lista atendimentos (com filtro opcional de data)
router.get('/', async (req, res) => {
  const { dataIni, dataFim, limite } = req.query;
  const limiteNum = Math.min(parseInt(limite) || 100, 500);
  const params = [req.user.empresaId];
  let where = 'empresa_id = $1';
  if (dataIni) {
    params.push(dataIni);
    where += ' AND data >= $' + params.length;
  }
  if (dataFim) {
    params.push(dataFim);
    where += ' AND data <= $' + params.length;
  }
  try {
    const r = await db.query(
      'SELECT * FROM lab_atendimentos WHERE ' + where + ' ORDER BY data DESC, id DESC LIMIT ' + limiteNum,
      params
    );
    res.json(r.rows.map(a => ({
      ...camelizar(a),
      data: formatarDataIso(a.data),
      valorTotal: toNum(a.valor_total)
    })));
  } catch (err) {
    console.error('[lab-atendimentos/list]', err);
    res.status(500).json({ error: 'Erro ao listar atendimentos.' });
  }
});

// Detalhe (com itens) - usado tambem pelo recibo
router.get('/:id', async (req, res) => {
  try {
    const rA = await db.query(
      'SELECT * FROM lab_atendimentos WHERE id = $1 AND empresa_id = $2',
      [req.params.id, req.user.empresaId]
    );
    if (rA.rows.length === 0) return res.status(404).json({ error: 'Atendimento nao encontrado.' });
    const rI = await db.query(
      'SELECT * FROM lab_atendimento_itens WHERE atendimento_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json({
      ...camelizar(rA.rows[0]),
      data: formatarDataIso(rA.rows[0].data),
      valorTotal: toNum(rA.rows[0].valor_total),
      itens: rI.rows.map(i => ({ ...camelizar(i), valor: toNum(i.valor) }))
    });
  } catch (err) {
    console.error('[lab-atendimentos/get]', err);
    res.status(500).json({ error: 'Erro ao carregar atendimento.' });
  }
});

// Cria atendimento + itens (transacao)
router.post('/', async (req, res) => {
  const { data, pacienteNome, pacienteDoc, pacienteTel, formaPagamento, obs, itens } = req.body || {};
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Adicione pelo menos um servico.' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let valorTotal = 0;
    for (const it of itens) {
      if (!it.servicoNome || !String(it.servicoNome).trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Nome do servico obrigatorio em cada item.' });
      }
      const v = Number(it.valor);
      if (!(v >= 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Valor invalido em um dos itens.' });
      }
      valorTotal += v;
    }
    const rA = await client.query(
      `INSERT INTO lab_atendimentos
         (empresa_id, data, paciente_nome, paciente_doc, paciente_tel,
          valor_total, forma_pagamento, obs, usuario_atendente_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.empresaId, data || new Date().toISOString().slice(0,10),
       pacienteNome || null, pacienteDoc || null, pacienteTel || null,
       valorTotal, formaPagamento || null, obs || null, req.user.userId || null]
    );
    const atendimentoId = rA.rows[0].id;
    const itensInseridos = [];
    for (const it of itens) {
      const rI = await client.query(
        `INSERT INTO lab_atendimento_itens (atendimento_id, servico_id, servico_nome, valor)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [atendimentoId, it.servicoId || null, String(it.servicoNome).trim(), Number(it.valor) || 0]
      );
      itensInseridos.push({ ...camelizar(rI.rows[0]), valor: toNum(rI.rows[0].valor) });
    }
    await client.query('COMMIT');
    res.json({
      ...camelizar(rA.rows[0]),
      data: formatarDataIso(rA.rows[0].data),
      valorTotal: toNum(rA.rows[0].valor_total),
      itens: itensInseridos
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[lab-atendimentos/create]', err);
    res.status(500).json({ error: 'Erro ao salvar atendimento: ' + err.message });
  } finally {
    client.release();
  }
});

// Exclui atendimento (CASCADE pega os itens)
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.query(
      'DELETE FROM lab_atendimentos WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Atendimento nao encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[lab-atendimentos/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir atendimento.' });
  }
});

module.exports = router;
