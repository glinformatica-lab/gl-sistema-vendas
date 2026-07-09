// routes/vendedores.js — Sistema de vendedores + comissões
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const { autenticar } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'gl-sistema-secret-key';

// === Middleware: autenticar VENDEDOR (não empresa) ===
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

// === Middleware: só master pode fazer CRUD de vendedores ===
function apenasMaster(req, res, next) {
  if (!req.usuario || !req.usuario.master) {
    return res.status(403).json({ error: 'Apenas o Master pode gerenciar vendedores.' });
  }
  next();
}

// === Gera código aleatório único de 6 dígitos ===
async function gerarCodigoUnico() {
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const { rows } = await db.query('SELECT id FROM vendedores WHERE codigo = $1', [codigo]);
    if (rows.length === 0) return codigo;
  }
  throw new Error('Não foi possível gerar código único.');
}

// === Cálculo de comissão ===
function calcularComissao(plano, valor) {
  // Regras:
  // Planos mensais (basico, pro): 100% da primeira mensalidade
  // Planos anuais: 15%
  const v = parseFloat(valor) || 0;
  const planosAnuais = ['anual', 'basico-anual', 'pro-anual', 'pro-fiscal-anual'];
  if (planosAnuais.includes(plano)) {
    return { percentual: 15, valor: +(v * 0.15).toFixed(2) };
  }
  // Mensais: comissão = valor da mensalidade (100%)
  if (['basico', 'pro', 'pro-fiscal', 'mensal'].includes(plano)) {
    return { percentual: 100, valor: +v.toFixed(2) };
  }
  // Trial e outros: sem comissão
  return { percentual: 0, valor: 0 };
}

// === Middleware autenticar reaproveitado (empresa/admin) ===
const requireAdminEmpresa = (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ error: 'Não autenticado.' });
  next();
};

// =========================================================
// === ROTAS DO MASTER (gerenciar vendedores) ===
// =========================================================

// GET /api/vendedores — Lista todos (só Master)
router.get('/', autenticar, apenasMaster, async (req, res) => {
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
    console.error('[vendedores/list]', e);
    res.status(500).json({ error: 'Erro ao listar vendedores.' });
  }
});

// POST /api/vendedores — Criar (só Master)
router.post('/', autenticar, apenasMaster, async (req, res) => {
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
    console.error('[vendedores/create]', e);
    res.status(500).json({ error: 'Erro ao criar vendedor.' });
  }
});

// PATCH /api/vendedores/:id — Editar (só Master)
router.patch('/:id', autenticar, apenasMaster, async (req, res) => {
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
    console.error('[vendedores/update]', e);
    res.status(500).json({ error: 'Erro ao editar vendedor.' });
  }
});

// POST /api/vendedores/:id/definir-senha — Master define senha do vendedor
router.post('/:id/definir-senha', autenticar, apenasMaster, async (req, res) => {
  const { id } = req.params;
  const { senha } = req.body || {};
  if (!senha || senha.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    await db.query('UPDATE vendedores SET senha_hash = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2', [hash, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[vendedores/senha]', e);
    res.status(500).json({ error: 'Erro ao definir senha.' });
  }
});

// DELETE /api/vendedores/:id — Remover
router.delete('/:id', autenticar, apenasMaster, async (req, res) => {
  const { id } = req.params;
  try {
    // Verifica se tem vendas
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM empresas WHERE vendedor_id = $1', [id]);
    if (parseInt(rows[0].n) > 0) {
      return res.status(400).json({ error: 'Vendedor tem vendas atribuídas. Marque como inativo em vez de excluir.' });
    }
    await db.query('DELETE FROM vendedores WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[vendedores/delete]', e);
    res.status(500).json({ error: 'Erro ao remover vendedor.' });
  }
});

// GET /api/vendedores/publico/:codigo — Consulta pública (só nome, pra tela /assinar)
router.get('/publico/:codigo', async (req, res) => {
  const { codigo } = req.params;
  try {
    const r = await db.query(`
      SELECT id, nome, status FROM vendedores WHERE codigo = $1 AND status = 'ativo'
    `, [codigo]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Código de indicação inválido.' });
    res.json({ id: r.rows[0].id, nome: r.rows[0].nome, codigo });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao consultar vendedor.' });
  }
});

// =========================================================
// === COMISSÕES (Master) ===
// =========================================================

// GET /api/vendedores/comissoes/todas — Master vê todas
router.get('/comissoes/todas', autenticar, apenasMaster, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT c.*, v.nome AS vendedor_nome, v.codigo AS vendedor_codigo,
             e.nome_fantasia AS empresa_nome
      FROM comissoes c
      JOIN vendedores v ON v.id = c.vendedor_id
      JOIN empresas e ON e.id = c.empresa_id
      ORDER BY c.criada_em DESC
      LIMIT 500
    `);
    res.json(r.rows);
  } catch (e) {
    console.error('[comissoes/all]', e);
    res.status(500).json({ error: 'Erro ao listar comissões.' });
  }
});

// POST /api/vendedores/comissoes/:id/marcar-paga — Master marca como paga
router.post('/comissoes/:id/marcar-paga', autenticar, apenasMaster, async (req, res) => {
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
    console.error('[comissoes/pagar]', e);
    res.status(500).json({ error: 'Erro ao marcar comissão como paga.' });
  }
});

// POST /api/vendedores/comissoes/:id/cancelar — Master cancela (ex: cliente cancelou nos 30 dias)
router.post('/comissoes/:id/cancelar', autenticar, apenasMaster, async (req, res) => {
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
    res.status(500).json({ error: 'Erro ao cancelar comissão.' });
  }
});

// =========================================================
// === LOGIN E PAINEL DO VENDEDOR ===
// =========================================================

// POST /api/vendedores/login — Login do vendedor (público)
router.post('/login', async (req, res) => {
  const { codigo, senha } = req.body || {};
  if (!codigo || !senha) return res.status(400).json({ error: 'Código e senha obrigatórios.' });
  try {
    const r = await db.query('SELECT * FROM vendedores WHERE codigo = $1 AND status = $2', [codigo, 'ativo']);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Código inválido ou vendedor inativo.' });
    const v = r.rows[0];
    if (!v.senha_hash) return res.status(401).json({ error: 'Senha ainda não foi definida. Contate a GL Informática.' });
    const ok = await bcrypt.compare(senha, v.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta.' });
    const token = jwt.sign({ id: v.id, codigo: v.codigo, nome: v.nome, tipo: 'vendedor' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, vendedor: { id: v.id, nome: v.nome, codigo: v.codigo } });
  } catch (e) {
    console.error('[vendedor/login]', e);
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

// GET /api/vendedores/me/dashboard — Dashboard do vendedor logado
router.get('/me/dashboard', autenticarVendedor, async (req, res) => {
  const vendedorId = req.vendedor.id;
  try {
    const totais = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM empresas WHERE vendedor_id = $1) AS total_indicacoes,
        (SELECT COUNT(*) FROM empresas WHERE vendedor_id = $1 AND status = 'ativa') AS ativas,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes WHERE vendedor_id = $1 AND status = 'paga'), 0) AS pago,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes WHERE vendedor_id = $1 AND status = 'pendente' AND CURRENT_DATE >= data_liberacao), 0) AS liberado_pendente,
        COALESCE((SELECT SUM(valor_comissao) FROM comissoes WHERE vendedor_id = $1 AND status = 'pendente' AND CURRENT_DATE < data_liberacao), 0) AS bloqueado_30dias
    `, [vendedorId]);
    res.json(totais.rows[0]);
  } catch (e) {
    console.error('[vendedor/dashboard]', e);
    res.status(500).json({ error: 'Erro ao carregar dashboard.' });
  }
});

// GET /api/vendedores/me/vendas?ano=2026&mes=07 — Vendas + comissões do vendedor no mês
router.get('/me/vendas', autenticarVendedor, async (req, res) => {
  const vendedorId = req.vendedor.id;
  const { ano, mes } = req.query;
  let where = 'c.vendedor_id = $1';
  const params = [vendedorId];
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
             e.nome_fantasia AS empresa_nome
      FROM comissoes c
      JOIN empresas e ON e.id = c.empresa_id
      WHERE ${where}
      ORDER BY c.data_venda DESC
    `, params);
    // Contadores da meta
    const totalVendas = r.rows.length;
    const totalComissao = r.rows.reduce((s, x) => s + parseFloat(x.valor_comissao), 0);
    res.json({
      vendas: r.rows,
      totalVendas,
      totalComissao,
      metaMensal: 5,
      metaAtingida: totalVendas >= 5
    });
  } catch (e) {
    console.error('[vendedor/vendas]', e);
    res.status(500).json({ error: 'Erro ao listar vendas.' });
  }
});

// GET /api/vendedores/me/perfil
router.get('/me/perfil', autenticarVendedor, async (req, res) => {
  try {
    const r = await db.query('SELECT id, nome, codigo, telefone, email, chave_pix, tipo_pix FROM vendedores WHERE id = $1', [req.vendedor.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Vendedor não encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao carregar perfil.' });
  }
});

// Export helpers
router.calcularComissao = calcularComissao;
module.exports = router;
