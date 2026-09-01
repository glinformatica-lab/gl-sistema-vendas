// ============================================
// SERVIÇOS DO SALÃO (catálogo)
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

async function requerSalao(req, res, next) {
  try {
    const r = await db.query('SELECT modulo_salao FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.modulo_salao) {
      return res.status(403).json({ error: 'Feature disponível apenas com Módulo Salão.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo: ' + e.message });
  }
}
router.use(requerSalao);

function camelizar(row) {
  const out = {};
  for (const k in row) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    out[camel] = row[k];
  }
  return out;
}

// ==========================================
// GET / — Lista serviços
// ==========================================
router.get('/', async (req, res) => {
  try {
    const incluirInativos = req.query.incluirInativos === 'true';
    const where = ['empresa_id = $1'];
    if (!incluirInativos) where.push('ativo = TRUE');
    const r = await db.query(
      `SELECT * FROM servicos_salao WHERE ${where.join(' AND ')} ORDER BY categoria NULLS LAST, nome`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(row => ({
      ...camelizar(row),
      produtosReceita: row.produtos_receita || []
    })));
  } catch (err) {
    console.error('[servicos-salao] GET /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /:id
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await db.query(
      `SELECT * FROM servicos_salao WHERE id=$1 AND empresa_id=$2`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado.' });
    const s = r.rows[0];
    res.json({ ...camelizar(s), produtosReceita: s.produtos_receita || [] });
  } catch (err) {
    console.error('[servicos-salao] GET /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST /
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { nome, precoPadrao, duracaoPadraoMin, produtosReceita, categoria, ativo } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const r = await db.query(
      `INSERT INTO servicos_salao
        (empresa_id, nome, preco_padrao, duracao_padrao_min, produtos_receita, categoria, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.user.empresaId,
        nome.trim(),
        Number(precoPadrao) || 0,
        duracaoPadraoMin ? Number(duracaoPadraoMin) : null,
        JSON.stringify(produtosReceita || []),
        categoria || null,
        ativo === false ? false : true
      ]
    );
    const s = r.rows[0];
    res.status(201).json({ ...camelizar(s), produtosReceita: s.produtos_receita || [] });
  } catch (err) {
    console.error('[servicos-salao] POST /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// PUT /:id
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

    const { nome, precoPadrao, duracaoPadraoMin, produtosReceita, categoria, ativo } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const r = await db.query(
      `UPDATE servicos_salao
         SET nome=$1, preco_padrao=$2, duracao_padrao_min=$3,
             produtos_receita=$4, categoria=$5, ativo=$6
       WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [
        nome.trim(),
        Number(precoPadrao) || 0,
        duracaoPadraoMin ? Number(duracaoPadraoMin) : null,
        JSON.stringify(produtosReceita || []),
        categoria || null,
        ativo === false ? false : true,
        id,
        req.user.empresaId
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado.' });
    const s = r.rows[0];
    res.json({ ...camelizar(s), produtosReceita: s.produtos_receita || [] });
  } catch (err) {
    console.error('[servicos-salao] PUT /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// DELETE /:id (soft delete)
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await db.query(
      `UPDATE servicos_salao SET ativo=FALSE WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Serviço não encontrado.' });
    res.json({ ok: true, mensagem: 'Serviço inativado.' });
  } catch (err) {
    console.error('[servicos-salao] DELETE /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
