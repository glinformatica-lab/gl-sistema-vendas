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

// Lista insumos (todos produtos da empresa, com info relevante pro lab)
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, codigo, nome, fornecedor, estoque, estoque_minimo,
              preco_custo, validade, observacao_interna
       FROM produtos
       WHERE empresa_id = $1
       ORDER BY nome`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(p => ({
      ...camelizar(p),
      estoque: toNum(p.estoque),
      estoqueMinimo: toNum(p.estoque_minimo),
      precoCusto: toNum(p.preco_custo),
      validade: formatarDataIso(p.validade)
    })));
  } catch (err) {
    console.error('[lab-insumos/list]', err);
    res.status(500).json({ error: 'Erro ao listar insumos.' });
  }
});

// Cria insumo
router.post('/', async (req, res) => {
  const { codigo, nome, fornecedor, estoque, estoqueMinimo, precoCusto, validade, observacaoInterna } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome e obrigatorio.' });
  try {
    // Gera codigo auto se vazio
    let codigoFinal = (codigo || '').trim();
    if (!codigoFinal) {
      const r = await db.query('SELECT codigo FROM produtos WHERE empresa_id = $1', [req.user.empresaId]);
      let max = 1000;
      for (const row of r.rows) {
        if (row.codigo && /^\d+$/.test(row.codigo)) {
          const n = parseInt(row.codigo, 10);
          if (n > max) max = n;
        }
      }
      codigoFinal = String(max + 1);
    }
    const precoVendaDefault = Number(precoCusto) || 0;
    const ins = await db.query(
      `INSERT INTO produtos
         (empresa_id, codigo, nome, fornecedor, estoque, estoque_minimo,
          preco_custo, preco_venda, validade, observacao_interna)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.user.empresaId, codigoFinal, nome.trim(), fornecedor || null,
       Number(estoque) || 0, Number(estoqueMinimo) || 0,
       Number(precoCusto) || 0, precoVendaDefault,
       validade || null, observacaoInterna || null]
    );
    const p = ins.rows[0];
    res.json({
      ...camelizar(p),
      estoque: toNum(p.estoque),
      estoqueMinimo: toNum(p.estoque_minimo),
      precoCusto: toNum(p.preco_custo),
      validade: formatarDataIso(p.validade)
    });
  } catch (err) {
    console.error('[lab-insumos/create]', err);
    res.status(500).json({ error: 'Erro ao criar insumo: ' + err.message });
  }
});

// Atualiza insumo
router.put('/:id', async (req, res) => {
  const { codigo, nome, fornecedor, estoque, estoqueMinimo, precoCusto, validade, observacaoInterna } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome e obrigatorio.' });
  try {
    const r = await db.query(
      `UPDATE produtos SET
         codigo = COALESCE($1, codigo),
         nome = $2,
         fornecedor = $3,
         estoque = $4,
         estoque_minimo = $5,
         preco_custo = $6,
         preco_venda = $6,
         validade = $7,
         observacao_interna = $8
       WHERE id = $9 AND empresa_id = $10
       RETURNING *`,
      [codigo && codigo.trim() ? codigo.trim() : null,
       nome.trim(), fornecedor || null,
       Number(estoque) || 0, Number(estoqueMinimo) || 0,
       Number(precoCusto) || 0,
       validade || null, observacaoInterna || null,
       req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Insumo nao encontrado.' });
    const p = r.rows[0];
    res.json({
      ...camelizar(p),
      estoque: toNum(p.estoque),
      estoqueMinimo: toNum(p.estoque_minimo),
      precoCusto: toNum(p.preco_custo),
      validade: formatarDataIso(p.validade)
    });
  } catch (err) {
    console.error('[lab-insumos/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar insumo.' });
  }
});

// Exclui insumo
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.query(
      'DELETE FROM produtos WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Insumo nao encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[lab-insumos/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir insumo.' });
  }
});

module.exports = router;
