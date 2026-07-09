// routes/vendedores.js — ROTAS PÚBLICAS + PAINEL VENDEDOR (sem autenticação Master)
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'gl-sistema-secret-key';

function autenticarVendedor(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.tipo !== 'vendedor') return res.status(403).json({ error: 'Acesso apenas para vendedor.' });
    req.vendedor = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

// GET público: consulta nome do vendedor pelo código
router.get('/publico/:codigo', async (req, res) => {
  try {
    const r = await db.query(`SELECT id, nome FROM vendedores WHERE codigo = $1 AND status = 'ativo'`, [req.params.codigo]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Código inválido.' });
    res.json({ id: r.rows[0].id, nome: r.rows[0].nome, codigo: req.params.codigo });
  } catch (e) { res.status(500).json({ error: 'Erro ao consultar.' }); }
});

// Login vendedor
router.post('/login', async (req, res) => {
  const { codigo, senha } = req.body || {};
  if (!codigo || !senha) return res.status(400).json({ error: 'Código e senha obrigatórios.' });
  try {
    const r = await db.query('SELECT * FROM vendedores WHERE codigo = $1 AND status = $2', [codigo, 'ativo']);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Código inválido ou inativo.' });
    const v = r.rows[0];
    if (!v.senha_hash) return res.status(401).json({ error: 'Senha não definida. Contate a GL.' });
    const ok = await bcrypt.compare(senha, v.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });
    const token = jwt.sign({ id: v.id, codigo: v.codigo, nome: v.nome, tipo: 'vendedor' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, vendedor: { id: v.id, nome: v.nome, codigo: v.codigo } });
  } catch (e) {
    console.error('[vendedor/login]', e);
    res.status(500).json({ error: 'Erro no login.' });
  }
});

// Painel do vendedor
router.get('/me/dashboard', autenticarVendedor, async (req, res) => {
  try {
    const t = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM empresas WHERE vendedor_id = $1) AS total_indicacoes,
        (SELECT COUNT(*) FROM empresas WHERE vendedor_id = $1 AND status = 'ativa') AS ativas,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes WHERE vendedor_id = $1 AND status = 'paga'), 0) AS pago,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes WHERE vendedor_id = $1 AND status = 'pendente' AND CURRENT_DATE >= data_liberacao), 0) AS liberado_pendente,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes WHERE vendedor_id = $1 AND status = 'pendente' AND CURRENT_DATE < data_liberacao), 0) AS bloqueado_30dias
    `, [req.vendedor.id]);
    res.json(t.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

router.get('/me/vendas', autenticarVendedor, async (req, res) => {
  const { ano, mes } = req.query;
  let where = 'c.vendedor_id = $1';
  const params = [req.vendedor.id];
  if (ano && mes) {
    params.push(`${ano}-${String(mes).padStart(2, '0')}-01`);
    params.push(`${ano}-${String(mes).padStart(2, '0')}-31`);
    where += ` AND c.data_venda >= $2 AND c.data_venda <= $3`;
  } else if (ano) {
    params.push(`${ano}-01-01`);
    params.push(`${ano}-12-31`);
    where += ` AND c.data_venda >= $2 AND c.data_venda <= $3`;
  }
  try {
    const r = await db.query(`
      SELECT c.id, c.plano, c.valor_venda, c.percentual, c.valor_comissao,
             c.data_venda, c.data_liberacao, c.status, c.data_pagamento,
             e.nome AS empresa_nome
      FROM comissoes c JOIN empresas e ON e.id = c.empresa_id
      WHERE ${where} ORDER BY c.data_venda DESC
    `, params);
    const totalVendas = r.rows.length;
    const totalComissao = r.rows.reduce((s, x) => s + parseFloat(x.valor_comissao), 0);
    res.json({ vendas: r.rows, totalVendas, totalComissao, metaMensal: 5, metaAtingida: totalVendas >= 5 });
  } catch (e) { res.status(500).json({ error: 'Erro ao listar.' }); }
});

module.exports = router;
