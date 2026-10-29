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

// Lista servicos da empresa (default: so ativos)
router.get('/', async (req, res) => {
  try {
    const incluirInativos = req.query.incluirInativos === 'true';
    const filtroAtivo = incluirInativos ? '' : ' AND ativo = TRUE';
    const r = await db.query(
      `SELECT * FROM lab_servicos WHERE empresa_id = $1${filtroAtivo} ORDER BY nome`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(s => ({ ...camelizar(s), preco: toNum(s.preco) })));
  } catch (err) {
    console.error('[lab-servicos/list]', err);
    res.status(500).json({ error: 'Erro ao listar servicos.' });
  }
});

// Cria servico
router.post('/', async (req, res) => {
  const { codigo, nome, descricao, preco } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome e obrigatorio.' });
  if (preco == null || Number(preco) < 0) return res.status(400).json({ error: 'Preco invalido.' });
  try {
    const r = await db.query(
      `INSERT INTO lab_servicos (empresa_id, codigo, nome, descricao, preco)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.empresaId, codigo || null, nome.trim(), descricao || null, Number(preco) || 0]
    );
    res.json({ ...camelizar(r.rows[0]), preco: toNum(r.rows[0].preco) });
  } catch (err) {
    console.error('[lab-servicos/create]', err);
    res.status(500).json({ error: 'Erro ao criar servico: ' + err.message });
  }
});

// Edita servico
router.put('/:id', async (req, res) => {
  const { codigo, nome, descricao, preco, ativo } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome e obrigatorio.' });
  try {
    const r = await db.query(
      `UPDATE lab_servicos SET
         codigo = $1, nome = $2, descricao = $3, preco = $4,
         ativo = COALESCE($5, ativo)
       WHERE id = $6 AND empresa_id = $7
       RETURNING *`,
      [codigo || null, nome.trim(), descricao || null, Number(preco) || 0,
       (typeof ativo === 'boolean' ? ativo : null), req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Servico nao encontrado.' });
    res.json({ ...camelizar(r.rows[0]), preco: toNum(r.rows[0].preco) });
  } catch (err) {
    console.error('[lab-servicos/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar servico.' });
  }
});

// Exclui servico (hard delete; a FK em lab_atendimento_itens usa SET NULL)
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.query(
      'DELETE FROM lab_servicos WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Servico nao encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[lab-servicos/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir servico.' });
  }
});

module.exports = router;
