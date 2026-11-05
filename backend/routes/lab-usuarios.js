const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
const parsePerms = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
};
const serializePerms = (arr) => Array.isArray(arr) ? JSON.stringify(arr) : null;

  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};

// Retorna o usuario logado (pra o frontend saber departamento + papel)
router.get('/me', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, email, nome, papel, departamento, permissoes FROM usuarios WHERE id = $1 AND empresa_id = $2',
      [req.user.userId, req.user.empresaId]
    );
    if (!r.rowCount) {
      // Fallback: usuario do token (ex: admin master)
      return res.json({
        id: req.user.userId,
        email: req.user.email || null,
        nome: req.user.nome || 'Admin',
        papel: req.user.papel || 'admin',
        departamento: null
      });
    }
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    console.error('[lab-usuarios/me]', err);
    res.status(500).json({ error: 'Erro ao buscar usuario.' });
  }
});

// Lista usuarios da empresa
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, email, nome, papel, departamento, permissoes, criado_em FROM usuarios WHERE empresa_id = $1 ORDER BY departamento NULLS LAST, nome',
      [req.user.empresaId]
    );
    res.json(r.rows.map(row => ({ ...camelizar(row), permissoes: parsePerms(row.permissoes) })));
  } catch (err) {
    console.error('[lab-usuarios/list]', err);
    res.status(500).json({ error: 'Erro ao listar usuarios.' });
  }
});

// Cria novo usuario (so admin ou gerencia)
router.post('/', async (req, res) => {
  const { email, nome, senha, departamento, papel, permissoes } = req.body || {};
  if (!email || !nome || !senha) return res.status(400).json({ error: 'email, nome e senha obrigatorios.' });
  if (String(senha).length < 4) return res.status(400).json({ error: 'Senha minima de 4 caracteres.' });
  // Permissao: so admin ou gerencia
  if (req.user.papel !== 'admin' && req.user.departamento !== 'gerencia') {
    return res.status(403).json({ error: 'Apenas admin/gerencia podem criar usuarios.' });
  }
  try {
    const hash = await bcrypt.hash(senha, 10);
    const ins = await db.query(
      `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel, departamento, permissoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, nome, papel, departamento, permissoes`,
      [req.user.empresaId, String(email).toLowerCase().trim(), nome.trim(), hash,
       papel || 'operador', departamento || null, serializePerms(permissoes)]
    );
    const row = ins.rows[0]; res.json({ ...camelizar(row), permissoes: parsePerms(row.permissoes) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ja cadastrado.' });
    console.error('[lab-usuarios/create]', err);
    res.status(500).json({ error: 'Erro ao criar: ' + err.message });
  }
});

// Edita usuario
router.put('/:id', async (req, res) => {
  const { email, nome, departamento, papel, senha, permissoes } = req.body || {};
  // Permissao
  if (req.user.papel !== 'admin' && req.user.departamento !== 'gerencia') {
    return res.status(403).json({ error: 'Apenas admin/gerencia podem editar usuarios.' });
  }
  const sets = [];
  const vals = [];
  let i = 1;
  if (email !== undefined) { sets.push(`email = $${i++}`); vals.push(String(email).toLowerCase().trim()); }
  if (nome !== undefined)  { sets.push(`nome = $${i++}`);  vals.push(String(nome).trim()); }
  if (departamento !== undefined) { sets.push(`departamento = ${i++}`); vals.push(departamento || null); }
  if (permissoes !== undefined) { sets.push(`permissoes = $${i++}`); vals.push(serializePerms(permissoes)); }
  if (papel !== undefined) { sets.push(`papel = $${i++}`); vals.push(papel); }
  if (senha && String(senha).length >= 4) {
    const hash = await bcrypt.hash(senha, 10);
    sets.push(`senha_hash = $${i++}`);
    vals.push(hash);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar.' });
  vals.push(req.params.id, req.user.empresaId);
  try {
    const r = await db.query(
      `UPDATE usuarios SET ${sets.join(', ')}
       WHERE id = $${i++} AND empresa_id = $${i}
       RETURNING id, email, nome, papel, departamento, permissoes`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Usuario nao encontrado.' });
    const row = r.rows[0]; res.json({ ...camelizar(row), permissoes: parsePerms(row.permissoes) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ja cadastrado.' });
    console.error('[lab-usuarios/update]', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// Deleta
router.delete('/:id', async (req, res) => {
  if (req.user.papel !== 'admin' && req.user.departamento !== 'gerencia') {
    return res.status(403).json({ error: 'Apenas admin/gerencia podem excluir usuarios.' });
  }
  if (String(req.params.id) === String(req.user.userId)) {
    return res.status(400).json({ error: 'Nao pode excluir o proprio usuario.' });
  }
  try {
    const r = await db.query(
      'DELETE FROM usuarios WHERE id = $1 AND empresa_id = $2 RETURNING id',
      [req.params.id, req.user.empresaId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Usuario nao encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[lab-usuarios/delete]', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
