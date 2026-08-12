const express = require('express');
const db = require('../db');
const router = express.Router();

const camelizar = (obj) => {
  if (!obj) return obj;
  const r = {};
  for (const k in obj) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    r[camel] = obj[k];
  }
  return r;
};

// Middleware: verifica se empresa tem módulo iluminação ativo
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id = $1', [req.user.empresaId]);
    if (r.rows.length === 0 || !r.rows[0].usa_ambientes) {
      return res.status(403).json({ error: 'Recurso não está ativo para sua empresa.' });
    }
    next();
  } catch (e) {
    console.error('[transportadoras/mw]', e);
    res.status(500).json({ error: 'Erro ao verificar permissão.' });
  }
}

// GET /api/transportadoras
router.get('/', requerAmbientes, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM transportadoras
       WHERE empresa_id = $1 AND ativo = true
       ORDER BY nome`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(camelizar));
  } catch (err) {
    console.error('[transportadoras/list]', err);
    res.status(500).json({ error: 'Erro ao listar transportadoras.' });
  }
});

// POST /api/transportadoras
router.post('/', requerAmbientes, async (req, res) => {
  const { nome, cnpj, telefone, email, endereco, bairro, cidade, uf, cep, contato, observacao } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    const r = await db.query(
      `INSERT INTO transportadoras
        (empresa_id, nome, cnpj, telefone, email, endereco, bairro, cidade, uf, cep, contato, observacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.user.empresaId,
        nome.trim().toUpperCase(),
        (cnpj || '').trim() || null,
        (telefone || '').trim() || null,
        (email || '').trim().toLowerCase() || null,
        (endereco || '').trim().toUpperCase() || null,
        (bairro || '').trim().toUpperCase() || null,
        (cidade || '').trim().toUpperCase() || null,
        (uf || '').trim().toUpperCase().slice(0, 2) || null,
        (cep || '').trim() || null,
        (contato || '').trim().toUpperCase() || null,
        (observacao || '').trim() || null
      ]
    );
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[transportadoras/create]', err);
    res.status(500).json({ error: 'Erro ao criar transportadora.' });
  }
});

// PUT /api/transportadoras/:id
router.put('/:id', requerAmbientes, async (req, res) => {
  const { nome, cnpj, telefone, email, endereco, bairro, cidade, uf, cep, contato, observacao } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    const r = await db.query(
      `UPDATE transportadoras
       SET nome=$1, cnpj=$2, telefone=$3, email=$4, endereco=$5, bairro=$6,
           cidade=$7, uf=$8, cep=$9, contato=$10, observacao=$11, atualizado_em=NOW()
       WHERE id=$12 AND empresa_id=$13 RETURNING *`,
      [
        nome.trim().toUpperCase(),
        (cnpj || '').trim() || null,
        (telefone || '').trim() || null,
        (email || '').trim().toLowerCase() || null,
        (endereco || '').trim().toUpperCase() || null,
        (bairro || '').trim().toUpperCase() || null,
        (cidade || '').trim().toUpperCase() || null,
        (uf || '').trim().toUpperCase().slice(0, 2) || null,
        (cep || '').trim() || null,
        (contato || '').trim().toUpperCase() || null,
        (observacao || '').trim() || null,
        req.params.id,
        req.user.empresaId
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada.' });
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[transportadoras/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar transportadora.' });
  }
});

// DELETE /api/transportadoras/:id (soft delete)
router.delete('/:id', requerAmbientes, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE transportadoras SET ativo=false, atualizado_em=NOW()
       WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[transportadoras/delete]', err);
    res.status(500).json({ error: 'Erro ao remover transportadora.' });
  }
});

module.exports = router;
