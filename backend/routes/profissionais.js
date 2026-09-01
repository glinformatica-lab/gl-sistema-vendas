// ============================================
// PROFISSIONAIS DO SALÃO (cabeleireiras parceiras)
// Feature: só módulo salão
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: requer módulo salão ativo
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

// Helper: converte snake_case do banco pra camelCase pro frontend
function camelizar(row) {
  const out = {};
  for (const k in row) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    out[camel] = row[k];
  }
  return out;
}

// ==========================================
// GET / — Lista profissionais da empresa
// ==========================================
router.get('/', async (req, res) => {
  try {
    const incluirInativas = req.query.incluirInativas === 'true';
    const where = ['empresa_id = $1'];
    if (!incluirInativas) where.push('ativo = TRUE');
    const r = await db.query(
      `SELECT * FROM profissionais WHERE ${where.join(' AND ')} ORDER BY nome`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(camelizar));
  } catch (err) {
    console.error('[profissionais] GET /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /:id — Detalhe de uma profissional
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await db.query(
      `SELECT * FROM profissionais WHERE id=$1 AND empresa_id=$2`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Profissional não encontrada.' });
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[profissionais] GET /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST / — Cadastrar nova profissional
// ==========================================
router.post('/', async (req, res) => {
  try {
    const {
      nome, telefone, cpf, pix, dataInicio,
      percentualEspaco, percentualComissaoProduto,
      observacoes, ativo
    } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    const r = await db.query(
      `INSERT INTO profissionais
        (empresa_id, nome, telefone, cpf, pix, data_inicio,
         percentual_espaco, percentual_comissao_produto, observacoes, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.empresaId,
        nome.trim(),
        telefone || null,
        cpf || null,
        pix || null,
        dataInicio || null,
        Number(percentualEspaco) || 10,
        Number(percentualComissaoProduto) || 0,
        observacoes || null,
        ativo === false ? false : true
      ]
    );
    res.status(201).json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[profissionais] POST /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// PUT /:id — Atualizar profissional
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

    const {
      nome, telefone, cpf, pix, dataInicio,
      percentualEspaco, percentualComissaoProduto,
      observacoes, ativo
    } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    const r = await db.query(
      `UPDATE profissionais
         SET nome=$1, telefone=$2, cpf=$3, pix=$4, data_inicio=$5,
             percentual_espaco=$6, percentual_comissao_produto=$7,
             observacoes=$8, ativo=$9
       WHERE id=$10 AND empresa_id=$11
       RETURNING *`,
      [
        nome.trim(),
        telefone || null,
        cpf || null,
        pix || null,
        dataInicio || null,
        Number(percentualEspaco) || 10,
        Number(percentualComissaoProduto) || 0,
        observacoes || null,
        ativo === false ? false : true,
        id,
        req.user.empresaId
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Profissional não encontrada.' });
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[profissionais] PUT /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// DELETE /:id — Inativa (soft delete)
// ==========================================
// Não apaga porque profissional pode ter atendimentos/vales no histórico
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

    const r = await db.query(
      `UPDATE profissionais SET ativo=FALSE WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Profissional não encontrada.' });
    res.json({ ok: true, mensagem: 'Profissional inativada.' });
  } catch (err) {
    console.error('[profissionais] DELETE /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
