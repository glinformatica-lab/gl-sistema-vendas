// Rotas de gerenciamento de usuários da empresa.
// Apenas administradores podem criar, editar, listar e excluir.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { exigirAdmin } = require('../middleware/auth');

const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) {
    if (k === 'senha_hash') continue; // nunca devolve hash
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  }
  return out;
};

// Listar usuários da empresa (admin)
router.get('/', exigirAdmin, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, empresa_id, email, nome, papel, criado_em FROM usuarios WHERE empresa_id=$1 ORDER BY nome',
      [req.user.empresaId]
    );
    res.json(r.rows.map(camelizar));
  } catch (err) {
    console.error('[usuarios/list]', err);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// Criar novo usuário na empresa (admin)
router.post('/', exigirAdmin, async (req, res) => {
  const { nome, email, senha, papel } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ error: 'Preencha nome, email e senha.' });
  if (senha.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  const papelFinal = (papel === 'admin' || papel === 'vendedor') ? papel : 'vendedor';
  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const r = await db.query(
      `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, empresa_id, email, nome, papel, criado_em`,
      [req.user.empresaId, email.toLowerCase().trim(), nome.trim(), senhaHash, papelFinal]
    );
    res.json(camelizar(r.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Já existe um usuário com esse e-mail.' });
    console.error('[usuarios/create]', err);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// Editar usuário (nome, papel e — opcional — senha)
router.put('/:id', exigirAdmin, async (req, res) => {
  const { nome, papel, senha } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const papelFinal = (papel === 'admin' || papel === 'vendedor') ? papel : 'vendedor';
  // Não permite que o usuário rebaixe a si mesmo de admin para vendedor (evita ficar sem admin)
  if (Number(req.params.id) === req.user.userId && papelFinal !== 'admin') {
    return res.status(400).json({ error: 'Você não pode rebaixar seu próprio papel de admin.' });
  }
  try {
    let result;
    if (senha) {
      if (senha.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
      const senhaHash = await bcrypt.hash(senha, 10);
      result = await db.query(
        `UPDATE usuarios SET nome=$1, papel=$2, senha_hash=$3
         WHERE id=$4 AND empresa_id=$5 RETURNING id, empresa_id, email, nome, papel, criado_em`,
        [nome.trim(), papelFinal, senhaHash, req.params.id, req.user.empresaId]
      );
    } else {
      result = await db.query(
        `UPDATE usuarios SET nome=$1, papel=$2
         WHERE id=$3 AND empresa_id=$4 RETURNING id, empresa_id, email, nome, papel, criado_em`,
        [nome.trim(), papelFinal, req.params.id, req.user.empresaId]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json(camelizar(result.rows[0]));
  } catch (err) {
    console.error('[usuarios/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

// Excluir usuário (não pode excluir a si mesmo nem o último admin)
router.delete('/:id', exigirAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.userId) {
    return res.status(400).json({ error: 'Você não pode excluir a si mesmo.' });
  }
  try {
    // Verifica se é o último admin
    const alvo = await db.query('SELECT papel FROM usuarios WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    if (alvo.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (alvo.rows[0].papel === 'admin') {
      const c = await db.query("SELECT COUNT(*) AS n FROM usuarios WHERE empresa_id=$1 AND papel='admin'",
        [req.user.empresaId]);
      if (Number(c.rows[0].n) <= 1) {
        return res.status(400).json({ error: 'Não é possível excluir o último administrador.' });
      }
    }
    await db.query('DELETE FROM usuarios WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[usuarios/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

module.exports = router;
