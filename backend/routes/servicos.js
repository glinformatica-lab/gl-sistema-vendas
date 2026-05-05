// Rotas de Serviços (CRUD)
const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar serviços ativos
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM servicos WHERE empresa_id = $1 AND ativo = TRUE ORDER BY nome`,
      [req.user.empresaId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[servicos] GET', err);
    res.status(500).json({ error: 'Erro ao listar serviços.' });
  }
});

// Criar serviço
router.post('/', async (req, res) => {
  const { nome, descricao, valor } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Informe o nome do serviço.' });
  const valNum = parseFloat(valor) || 0;
  try {
    const r = await db.query(
      `INSERT INTO servicos (empresa_id, nome, descricao, valor)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.empresaId, nome.trim(), descricao || null, valNum]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[servicos] POST', err);
    res.status(500).json({ error: 'Erro ao criar serviço.' });
  }
});

// Atualizar serviço
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { nome, descricao, valor } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Informe o nome do serviço.' });
  const valNum = parseFloat(valor) || 0;
  try {
    const r = await db.query(
      `UPDATE servicos SET nome=$1, descricao=$2, valor=$3
       WHERE id=$4 AND empresa_id=$5 AND ativo=TRUE RETURNING *`,
      [nome.trim(), descricao || null, valNum, id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[servicos] PUT', err);
    res.status(500).json({ error: 'Erro ao atualizar serviço.' });
  }
});

// Excluir serviço (soft delete)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const r = await db.query(
      `UPDATE servicos SET ativo=FALSE WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[servicos] DELETE', err);
    res.status(500).json({ error: 'Erro ao excluir serviço.' });
  }
});

module.exports = router;
