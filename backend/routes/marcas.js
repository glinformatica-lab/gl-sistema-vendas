// ============================================
// MARCAS (Fabricantes)
// CRUD completo para cadastro de marcas
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: bloqueia se empresa não tem módulo iluminação
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.usa_ambientes) {
      return res.status(403).json({ error: 'Recurso disponível apenas com Módulo Iluminação ativo.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo.' });
  }
}

router.use(requerAmbientes);

// GET / — Lista marcas da empresa
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT m.*,
              (SELECT COUNT(*)::int FROM produtos p WHERE p.marca_id = m.id) AS total_produtos
       FROM marcas m
       WHERE m.empresa_id = $1
       ORDER BY m.nome ASC`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(row => ({
      id: row.id,
      nome: row.nome,
      observacao: row.observacao,
      totalProdutos: row.total_produtos,
      criadoEm: row.criado_em
    })));
  } catch (err) {
    console.error('[marcas] GET', err);
    res.status(500).json({ error: 'Erro ao listar marcas.' });
  }
});

// POST / — Cria nova marca
router.post('/', async (req, res) => {
  const { nome, observacao } = req.body || {};
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) return res.status(400).json({ error: 'Nome da marca é obrigatório.' });
  if (nomeLimpo.length > 120) return res.status(400).json({ error: 'Nome muito longo (máx 120).' });

  try {
    const r = await db.query(
      `INSERT INTO marcas (empresa_id, nome, observacao) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.empresaId, nomeLimpo, observacao || null]
    );
    res.json({
      id: r.rows[0].id,
      nome: r.rows[0].nome,
      observacao: r.rows[0].observacao,
      totalProdutos: 0,
      criadoEm: r.rows[0].criado_em
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Já existe uma marca com esse nome.' });
    }
    console.error('[marcas] POST', err);
    res.status(500).json({ error: 'Erro ao criar marca.' });
  }
});

// PUT /:id — Atualiza marca
router.put('/:id', async (req, res) => {
  const { nome, observacao } = req.body || {};
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) return res.status(400).json({ error: 'Nome da marca é obrigatório.' });
  if (nomeLimpo.length > 120) return res.status(400).json({ error: 'Nome muito longo (máx 120).' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE marcas SET nome=$1, observacao=$2
       WHERE id=$3 AND empresa_id=$4 RETURNING *`,
      [nomeLimpo, observacao || null, req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Marca não encontrada.' });
    }
    // Atualiza o cache do nome nos produtos vinculados
    await client.query(
      `UPDATE produtos SET marca=$1 WHERE marca_id=$2 AND empresa_id=$3`,
      [nomeLimpo, req.params.id, req.user.empresaId]
    );
    await client.query('COMMIT');
    res.json({
      id: r.rows[0].id,
      nome: r.rows[0].nome,
      observacao: r.rows[0].observacao,
      criadoEm: r.rows[0].criado_em
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Já existe uma marca com esse nome.' });
    }
    console.error('[marcas] PUT', err);
    res.status(500).json({ error: 'Erro ao atualizar marca.' });
  } finally {
    client.release();
  }
});

// DELETE /:id — Exclui marca (produtos vinculados perdem a referência, mas mantém o cache do nome)
router.delete('/:id', async (req, res) => {
  try {
    const r = await db.query(
      `DELETE FROM marcas WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Marca não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[marcas] DELETE', err);
    res.status(500).json({ error: 'Erro ao excluir marca.' });
  }
});

module.exports = router;
