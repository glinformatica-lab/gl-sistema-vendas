// routes/ambientes.js — CRUD de ambientes (só pra empresas com usa_ambientes=true)
const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: verifica se empresa usa ambientes
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.usuario.empresa_id]);
    if (r.rows.length === 0 || !r.rows[0].usa_ambientes) {
      return res.status(403).json({ error: 'Recurso de ambientes não está ativo pra sua empresa.' });
    }
    next();
  } catch (e) {
    console.error('[requerAmbientes]', e);
    res.status(500).json({ error: 'Erro ao validar recurso.' });
  }
}

// GET /api/ambientes — Lista ambientes ATIVOS
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, nome, ordem, ativo FROM ambientes WHERE empresa_id = $1 AND ativo = true ORDER BY ordem, nome',
      [req.usuario.empresa_id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error('[ambientes/list]', e);
    res.status(500).json({ error: 'Erro ao listar ambientes.' });
  }
});

// GET /api/ambientes/todos — Lista TODOS (inclui inativos - só pra admin)
router.get('/todos', requerAmbientes, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, nome, ordem, ativo FROM ambientes WHERE empresa_id = $1 ORDER BY ordem, nome',
      [req.usuario.empresa_id]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao listar ambientes.' });
  }
});

// POST /api/ambientes — Cria novo
router.post('/', requerAmbientes, async (req, res) => {
  const { nome, ordem } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const nomeUp = nome.trim().toUpperCase();
  try {
    const r = await db.query(
      'INSERT INTO ambientes (empresa_id, nome, ordem) VALUES ($1, $2, $3) RETURNING *',
      [req.usuario.empresa_id, nomeUp, ordem || 0]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Já existe um ambiente com esse nome.' });
    console.error('[ambientes/create]', e);
    res.status(500).json({ error: 'Erro ao criar ambiente.' });
  }
});

// PATCH /api/ambientes/:id — Edita
router.patch('/:id', requerAmbientes, async (req, res) => {
  const { id } = req.params;
  const { nome, ordem, ativo } = req.body || {};
  try {
    const nomeUp = nome ? nome.trim().toUpperCase() : null;
    const r = await db.query(
      `UPDATE ambientes
       SET nome = COALESCE($1, nome),
           ordem = COALESCE($2, ordem),
           ativo = COALESCE($3, ativo)
       WHERE id = $4 AND empresa_id = $5
       RETURNING *`,
      [nomeUp, ordem, ativo, id, req.usuario.empresa_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Ambiente não encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Já existe um ambiente com esse nome.' });
    res.status(500).json({ error: 'Erro ao editar ambiente.' });
  }
});

// DELETE /api/ambientes/:id — Remove (só se não tiver itens vinculados)
router.delete('/:id', requerAmbientes, async (req, res) => {
  const { id } = req.params;
  try {
    // Verifica se tem itens usando esse ambiente
    const usoQ = await db.query(
      'SELECT COUNT(*) AS n FROM orcamento_itens WHERE ambiente_id = $1',
      [id]
    );
    if (parseInt(usoQ.rows[0].n) > 0) {
      // Não deleta — só marca como inativo
      await db.query(
        'UPDATE ambientes SET ativo = false WHERE id = $1 AND empresa_id = $2',
        [id, req.usuario.empresa_id]
      );
      return res.json({ ok: true, inativado: true });
    }
    await db.query('DELETE FROM ambientes WHERE id = $1 AND empresa_id = $2', [id, req.usuario.empresa_id]);
    res.json({ ok: true, removido: true });
  } catch (e) {
    console.error('[ambientes/delete]', e);
    res.status(500).json({ error: 'Erro ao remover ambiente.' });
  }
});

module.exports = router;
