const express = require('express');
const db = require('../db');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};

// Normaliza doc removendo qualquer formatação (mantém só números)
const docNumeros = (d) => (d || '').replace(/\D/g, '');

// Sincroniza um fornecedor com mesmo nome OU mesmo doc do cliente
async function sincronizarFornecedor(empresaId, dados, dbClient) {
  const cli = dbClient || db;
  const nome = (dados.nome || '').trim();
  const docNum = docNumeros(dados.doc);
  if (!nome) return;
  // Procura fornecedor com mesmo doc OU mesmo nome (sem doc)
  let existente;
  if (docNum) {
    existente = await cli.query(
      `SELECT id FROM fornecedores
       WHERE empresa_id=$1 AND (REGEXP_REPLACE(COALESCE(doc,''),'\\D','','g')=$2 OR LOWER(nome)=LOWER($3))
       LIMIT 1`,
      [empresaId, docNum, nome]
    );
  } else {
    existente = await cli.query(
      'SELECT id FROM fornecedores WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2) LIMIT 1',
      [empresaId, nome]
    );
  }
  if (existente.rows.length > 0) {
    await cli.query(
      `UPDATE fornecedores SET nome=$1, doc=COALESCE($2, doc), telefone=COALESCE($3, telefone),
              cidade=COALESCE($4, cidade) WHERE id=$5 AND empresa_id=$6`,
      [nome, dados.doc || null, dados.telefone || null, dados.cidade || null,
       existente.rows[0].id, empresaId]
    );
  } else {
    await cli.query(
      `INSERT INTO fornecedores (empresa_id, nome, doc, telefone, cidade)
       VALUES ($1,$2,$3,$4,$5)`,
      [empresaId, nome, dados.doc || null, dados.telefone || null, dados.cidade || null]
    );
  }
}

router.get('/', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM clientes WHERE empresa_id=$1 ORDER BY nome',
      [req.user.empresaId]);
    res.json(r.rows.map(camelizar));
  } catch (err) {
    console.error('[clientes/list]', err);
    res.status(500).json({ error: 'Erro ao listar clientes.' });
  }
});

router.post('/', async (req, res) => {
  const { nome, doc, telefone, cep, endereco, bairro, cidade, uf, eTambemFornecedor } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    // Verifica duplicado por nome
    const dupNome = await db.query(
      'SELECT id, nome FROM clientes WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2)',
      [req.user.empresaId, nome.trim()]
    );
    if (dupNome.rows.length > 0) return res.status(400).json({ error: `Já existe um cliente cadastrado com o nome "${dupNome.rows[0].nome}".` });
    // Verifica duplicado por CPF/CNPJ (se informado)
    const docNum = docNumeros(doc);
    if (docNum) {
      const dupDoc = await db.query(
        `SELECT id, nome FROM clientes
         WHERE empresa_id=$1 AND REGEXP_REPLACE(COALESCE(doc,''),'\\D','','g')=$2`,
        [req.user.empresaId, docNum]
      );
      if (dupDoc.rows.length > 0) {
        return res.status(400).json({ error: `Já existe um cliente "${dupDoc.rows[0].nome}" com este CPF/CNPJ.` });
      }
    }
    const r = await db.query(
      `INSERT INTO clientes (empresa_id, nome, doc, telefone, cep, endereco, bairro, cidade, uf, e_tambem_fornecedor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.empresaId, nome.trim(), doc || null, telefone || null, cep || null,
       endereco || null, bairro || null, cidade || null, uf || null, !!eTambemFornecedor]
    );
    if (eTambemFornecedor) {
      try {
        await sincronizarFornecedor(req.user.empresaId, { nome: nome.trim(), doc, telefone, cidade });
      } catch (errSinc) {
        console.warn('[clientes/create] aviso ao sincronizar fornecedor:', errSinc.message);
      }
    }
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[clientes/create]', err);
    res.status(500).json({ error: 'Erro ao cadastrar cliente.' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome, doc, telefone, cep, endereco, bairro, cidade, uf, eTambemFornecedor } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    // Verifica duplicado por nome (excluindo o próprio registro)
    const dupNome = await db.query(
      'SELECT id, nome FROM clientes WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2) AND id != $3',
      [req.user.empresaId, nome.trim(), req.params.id]
    );
    if (dupNome.rows.length > 0) return res.status(400).json({ error: `Já existe outro cliente com o nome "${dupNome.rows[0].nome}".` });
    // Verifica duplicado por doc (excluindo o próprio registro)
    const docNum = docNumeros(doc);
    if (docNum) {
      const dupDoc = await db.query(
        `SELECT id, nome FROM clientes
         WHERE empresa_id=$1 AND REGEXP_REPLACE(COALESCE(doc,''),'\\D','','g')=$2 AND id != $3`,
        [req.user.empresaId, docNum, req.params.id]
      );
      if (dupDoc.rows.length > 0) {
        return res.status(400).json({ error: `Já existe outro cliente "${dupDoc.rows[0].nome}" com este CPF/CNPJ.` });
      }
    }
    const r = await db.query(
      `UPDATE clientes SET nome=$1, doc=$2, telefone=$3, cep=$4, endereco=$5, bairro=$6, cidade=$7, uf=$8, e_tambem_fornecedor=$9
       WHERE id=$10 AND empresa_id=$11 RETURNING *`,
      [nome.trim(), doc || null, telefone || null, cep || null, endereco || null,
       bairro || null, cidade || null, uf || null, !!eTambemFornecedor,
       req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (eTambemFornecedor) {
      try {
        await sincronizarFornecedor(req.user.empresaId, { nome: nome.trim(), doc, telefone, cidade });
      } catch (errSinc) {
        console.warn('[clientes/update] aviso ao sincronizar fornecedor:', errSinc.message);
      }
    }
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[clientes/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar cliente.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await db.query('DELETE FROM clientes WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [req.params.id, req.user.empresaId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[clientes/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir cliente.' });
  }
});

module.exports = router;
