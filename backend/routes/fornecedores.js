const express = require('express');
const db = require('../db');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};

const docNumeros = (d) => (d || '').replace(/\D/g, '');

// Sincroniza um cliente que tenha mesmo nome ou doc do fornecedor
// (idempotente: só atualiza se o cliente está marcado como "também é fornecedor")
async function sincronizarCliente(empresaId, dados, dbClient) {
  const cli = dbClient || db;
  const nome = (dados.nome || '').trim();
  const docNum = docNumeros(dados.doc);
  if (!nome) return;
  let existente;
  if (docNum) {
    existente = await cli.query(
      `SELECT id FROM clientes
       WHERE empresa_id=$1
         AND e_tambem_fornecedor = TRUE
         AND (REGEXP_REPLACE(COALESCE(doc,''),'\\D','','g')=$2 OR LOWER(nome)=LOWER($3))
       LIMIT 1`,
      [empresaId, docNum, nome]
    );
  } else {
    existente = await cli.query(
      `SELECT id FROM clientes
       WHERE empresa_id=$1 AND e_tambem_fornecedor = TRUE AND LOWER(nome)=LOWER($2)
       LIMIT 1`,
      [empresaId, nome]
    );
  }
  if (existente.rows.length > 0) {
    await cli.query(
      `UPDATE clientes SET nome=$1, doc=COALESCE($2, doc), telefone=COALESCE($3, telefone),
              cidade=COALESCE($4, cidade)
       WHERE id=$5 AND empresa_id=$6`,
      [nome, dados.doc || null, dados.telefone || null, dados.cidade || null,
       existente.rows[0].id, empresaId]
    );
  }
  // Se não existe cliente com flag "também é fornecedor", não cria automaticamente
  // (sincronização cliente -> fornecedor é unidirecional ao marcar a checkbox)
}

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
    // Duplicado por nome
    const dupNome = await db.query(
      'SELECT id, nome FROM fornecedores WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2)',
      [req.user.empresaId, nome.trim()]
    );
    if (dupNome.rows.length > 0) return res.status(400).json({ error: `Já existe um fornecedor cadastrado com o nome "${dupNome.rows[0].nome}".` });
    // Duplicado por doc (CPF/CNPJ)
    const docNum = docNumeros(doc);
    if (docNum) {
      const dupDoc = await db.query(
        `SELECT id, nome FROM fornecedores
         WHERE empresa_id=$1 AND REGEXP_REPLACE(COALESCE(doc,''),'\\D','','g')=$2`,
        [req.user.empresaId, docNum]
      );
      if (dupDoc.rows.length > 0) {
        return res.status(400).json({ error: `Já existe um fornecedor "${dupDoc.rows[0].nome}" com este CPF/CNPJ.` });
      }
    }
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
    // Duplicado por nome (excluindo o próprio)
    const dupNome = await db.query(
      'SELECT id, nome FROM fornecedores WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2) AND id != $3',
      [req.user.empresaId, nome.trim(), req.params.id]
    );
    if (dupNome.rows.length > 0) return res.status(400).json({ error: `Já existe outro fornecedor com o nome "${dupNome.rows[0].nome}".` });
    // Duplicado por doc (excluindo o próprio)
    const docNum = docNumeros(doc);
    if (docNum) {
      const dupDoc = await db.query(
        `SELECT id, nome FROM fornecedores
         WHERE empresa_id=$1 AND REGEXP_REPLACE(COALESCE(doc,''),'\\D','','g')=$2 AND id != $3`,
        [req.user.empresaId, docNum, req.params.id]
      );
      if (dupDoc.rows.length > 0) {
        return res.status(400).json({ error: `Já existe outro fornecedor "${dupDoc.rows[0].nome}" com este CPF/CNPJ.` });
      }
    }
    const r = await db.query(
      `UPDATE fornecedores SET nome=$1, doc=$2, telefone=$3, cidade=$4
       WHERE id=$5 AND empresa_id=$6 RETURNING *`,
      [nome.trim(), doc || null, telefone || null, cidade || null,
       req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    // Sincroniza cliente que tenha sido marcado como "também é fornecedor"
    try {
      await sincronizarCliente(req.user.empresaId, { nome: nome.trim(), doc, telefone, cidade });
    } catch (errSinc) {
      console.warn('[fornecedores/update] aviso ao sincronizar cliente:', errSinc.message);
    }
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
