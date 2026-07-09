// routes/vendedores-master.js — Gestão de vendedores e comissões (SÓ MASTER)
// Registrado no server.js com autenticarMaster já aplicado:
//   app.use('/api/master-vendedores', autenticarMaster, require('./routes/vendedores-master'));
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');

// Gera código aleatório único de 6 dígitos
async function gerarCodigoUnico() {
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const { rows } = await db.query('SELECT id FROM vendedores WHERE codigo = $1', [codigo]);
    if (rows.length === 0) return codigo;
  }
  throw new Error('Não foi possível gerar código único.');
}

// GET /api/master-vendedores — Lista todos
router.get('/', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT v.*,
        (SELECT COUNT(*) FROM empresas e WHERE e.vendedor_id = v.id) AS total_indicacoes,
        (SELECT COUNT(*) FROM empresas e WHERE e.vendedor_id = v.id AND e.status = 'ativa') AS total_ativas,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes c WHERE c.vendedor_id = v.id AND c.status = 'paga'), 0) AS total_pago,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes c WHERE c.vendedor_id = v.id AND c.status = 'pendente'), 0) AS total_pendente
      FROM vendedores v
      ORDER BY v.criado_em DESC
    `);
    res.json(r.rows.map(v => ({
      id: v.id,
      nome: v.nome,
      telefone: v.telefone,
      email: v.email,
      codigo: v.codigo,
      status: v.status,
      chavePix: v.chave_pix,
      tipoPix: v.tipo_pix,
      observacoes: v.observacoes,
      totalIndicacoes: parseInt(v.total_indicacoes),
      totalAtivas: parseInt(v.total_ativas),
      totalPago: parseFloat(v.total_pago),
      totalPendente: parseFloat(v.total_pendente),
      criadoEm: v.criado_em,
      temSenha: !!v.senha_hash
    })));
  } catch (e) {
    console.error('[master-vendedores/list]', e);
    res.status(500).json({ error: 'Erro ao listar vendedores.' });
  }
});

// POST /api/master-vendedores — Criar
router.post('/', async (req, res) => {
  const { nome, telefone, email, chavePix, tipoPix, observacoes } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
  try {
    const codigo = await gerarCodigoUnico();
    const r = await db.query(`
      INSERT INTO vendedores (nome, telefone, email, codigo, chave_pix, tipo_pix, observacoes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [nome.trim(), telefone || null, email || null, codigo, chavePix || null, tipoPix || null, observacoes || null]);
    res.status(201).json({ ok: true, vendedor: r.rows[0] });
  } catch (e) {
    console.error('[master-vendedores/create]', e);
    res.status(500).json({ error: 'Erro ao criar vendedor.' });
  }
});

// PATCH /api/master-vendedores/:id — Editar
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, email, status, chavePix, tipoPix, observacoes } = req.body || {};
  try {
    const r = await db.query(`
      UPDATE vendedores
      SET nome = COALESCE($1, nome),
          telefone = COALESCE($2, telefone),
          email = COALESCE($3, email),
          status = COALESCE($4, status),
          chave_pix = COALESCE($5, chave_pix),
          tipo_pix = COALESCE($6, tipo_pix),
          observacoes = COALESCE($7, observacoes),
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `, [nome, telefone, email, status, chavePix, tipoPix, observacoes, id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Vendedor não encontrado.' });
    res.json({ ok: true, vendedor: r.rows[0] });
  } catch (e) {
    console.error('[master-vendedores/update]', e);
    res.status(500).json({ error: 'Erro ao editar vendedor.' });
  }
});

// POST /api/master-vendedores/:id/definir-senha
router.post('/:id/definir-senha', async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body || {};
  if (!senha || senha.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    await db.query('UPDATE vendedores SET senha_hash = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2', [hash, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[master-vendedores/senha]', e);
    res.status(500).json({ error: 'Erro ao definir senha.' });
  }
});

// DELETE /api/master-vendedores/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM empresas WHERE vendedor_id = $1', [id]);
    if (parseInt(rows[0].n) > 0) {
      return res.status(400).json({ error: 'Vendedor tem vendas atribuídas. Marque como inativo em vez de excluir.' });
    }
    await db.query('DELETE FROM vendedores WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[master-vendedores/delete]', e);
    res.status(500).json({ error: 'Erro ao remover.' });
  }
});

// === COMISSÕES ===

// GET /api/master-vendedores/comissoes/todas
router.get('/comissoes/todas', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT c.*, v.nome AS vendedor_nome, v.codigo AS vendedor_codigo,
             e.nome AS empresa_nome
      FROM comissoes c
      JOIN vendedores v ON v.id = c.vendedor_id
      JOIN empresas e ON e.id = c.empresa_id
      ORDER BY c.criada_em DESC
      LIMIT 500
    `);
    res.json(r.rows);
  } catch (e) {
    console.error('[master-vendedores/comissoes]', e);
    res.status(500).json({ error: 'Erro ao listar comissões.' });
  }
});

// POST /api/master-vendedores/comissoes/:id/marcar-paga
router.post('/comissoes/:id/marcar-paga', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(`
      UPDATE comissoes SET status = 'paga', data_pagamento = CURRENT_DATE, atualizada_em = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'pendente' AND CURRENT_DATE >= data_liberacao
      RETURNING *
    `, [id]);
    if (r.rows.length === 0) {
      return res.status(400).json({ error: 'Comissão não encontrada, já paga ou ainda não liberada (aguardar 30 dias).' });
    }
    res.json({ ok: true, comissao: r.rows[0] });
  } catch (e) {
    console.error('[master-vendedores/pagar]', e);
    res.status(500).json({ error: 'Erro ao marcar como paga.' });
  }
});

// POST /api/master-vendedores/comissoes/:id/cancelar
router.post('/comissoes/:id/cancelar', async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body || {};
  try {
    await db.query(`
      UPDATE comissoes SET status = 'cancelada',
                            observacoes = COALESCE($2, observacoes),
                            atualizada_em = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id, motivo || 'Cancelada pelo Master']);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao cancelar.' });
  }
});

module.exports = router;
