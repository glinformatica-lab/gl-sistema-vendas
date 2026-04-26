const express = require('express');
const db = require('../db');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};

router.get('/', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM fornecedores WHERE empresa_id=$1 ORDER BY nome',
      [req.user.empresaId]);
    res.json(r.rows.map(camelizar));
  } catch (err) {
    console.error('[fornecedores/list]', err);
    res.status(500).json({ error: 'Erro ao listar fornecedores.' });
  }
});

router.post('/', async (req, res) => {
  const { nome, doc, telefone, cidade } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    const dup = await db.query(
      'SELECT id FROM fornecedores WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2)',
      [req.user.empresaId, nome.trim()]
    );
    if (dup.rows.length > 0) return res.status(400).json({ error: 'Já existe um fornecedor com esse nome.' });
    const r = await db.query(
      `INSERT INTO fornecedores (empresa_id, nome, doc, telefone, cidade)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.empresaId, nome.trim(), doc || null, telefone || null, cidade || null]
    );
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[fornecedores/create]', err);
    res.status(500).json({ error: 'Erro ao cadastrar fornecedor.' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome, doc, telefone, cidade } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    const r = await db.query(
      `UPDATE fornecedores SET nome=$1, doc=$2, telefone=$3, cidade=$4
       WHERE id=$5 AND empresa_id=$6 RETURNING *`,
      [nome.trim(), doc || null, telefone || null, cidade || null,
       req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[fornecedores/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar fornecedor.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await db.query('DELETE FROM fornecedores WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [req.params.id, req.user.empresaId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[fornecedores/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir fornecedor.' });
  }
});

module.exports = router;
