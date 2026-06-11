// Rotas do painel Master — gerencia empresas, licenças e pagamentos.
// Todas exigem token Master (autenticarMaster aplicado no server.js).
const express = require('express');
const db = require('../db');
const crypto = require('crypto');

const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) {
    if (k === 'senha_hash') continue;
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  }
  return out;
};
const formatarDataIso = (d) => {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10);
};

// Atualiza status conforme data_vencimento (helper)
async function atualizarStatusVencidas() {
  await db.query(`
    UPDATE empresas SET status='vencida'
    WHERE data_vencimento IS NOT NULL
      AND data_vencimento < CURRENT_DATE
      AND status IN ('trial', 'ativa')
  `);
}

// Dashboard / overview
router.get('/dashboard', async (req, res) => {
  try {
    await atualizarStatusVencidas();

    const empresas = await db.query('SELECT status, plano, valor_mensalidade FROM empresas');
    const total = empresas.rows.length;
    const ativas = empresas.rows.filter(e => e.status === 'ativa').length;
    const trial = empresas.rows.filter(e => e.status === 'trial').length;
    const vencidas = empresas.rows.filter(e => e.status === 'vencida').length;
    const bloqueadas = empresas.rows.filter(e => e.status === 'bloqueada').length;
    const receitaMensal = empresas.rows
      .filter(e => e.status === 'ativa')
      .reduce((s, e) => s + Number(e.valor_mensalidade || 0), 0);

    const usuarios = await db.query('SELECT COUNT(*)::int AS n FROM usuarios');
    const totalUsuarios = usuarios.rows[0].n;

    // Empresas com vencimento próximo (próximos 7 dias)
    const venc7 = await db.query(`
      SELECT id, nome, status, plano, data_vencimento, valor_mensalidade
      FROM empresas
      WHERE data_vencimento IS NOT NULL
        AND data_vencimento >= CURRENT_DATE
        AND data_vencimento <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY data_vencimento ASC
    `);

    // Pagamentos do mês corrente
    const pagMes = await db.query(`
      SELECT COALESCE(SUM(valor),0) AS total, COUNT(*)::int AS n
      FROM pagamentos
      WHERE data_pagamento >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    res.json({
      total, ativas, trial, vencidas, bloqueadas,
      receitaMensalEstimada: receitaMensal,
      totalUsuarios,
      vencimentosProximos: venc7.rows.map(r => ({ ...camelizar(r), dataVencimento: formatarDataIso(r.data_vencimento) })),
      pagamentosMes: { total: Number(pagMes.rows[0].total), quantidade: pagMes.rows[0].n }
    });
  } catch (err) {
    console.error('[master/dashboard]', err);
    res.status(500).json({ error: 'Erro ao carregar dashboard.' });
  }
});

// Lista empresas
router.get('/empresas', async (req, res) => {
  try {
    await atualizarStatusVencidas();
    const r = await db.query(`
      SELECT e.*,
             (SELECT COUNT(*)::int FROM usuarios u WHERE u.empresa_id = e.id) AS qtd_usuarios,
             (SELECT MAX(criada_em) FROM vendas WHERE empresa_id = e.id) AS ultima_venda,
             (SELECT u.email FROM usuarios u WHERE u.empresa_id = e.id AND u.papel = 'admin' ORDER BY u.id ASC LIMIT 1) AS email_admin,
             (SELECT u.grupo_id FROM usuarios u WHERE u.empresa_id = e.id AND u.papel = 'admin' ORDER BY u.id ASC LIMIT 1) AS grupo_id
      FROM empresas e
      ORDER BY e.criada_em DESC
    `);
    res.json(r.rows.map(row => ({
      ...camelizar(row),
      dataVencimento: formatarDataIso(row.data_vencimento),
      ultimaVenda: row.ultima_venda
    })));
  } catch (err) {
    console.error('[master/empresas/list]', err);
    res.status(500).json({ error: 'Erro ao listar empresas.' });
  }
});

// Detalhes de uma empresa (com usuários e pagamentos)
router.get('/empresas/:id', async (req, res) => {
  try {
    const eRes = await db.query('SELECT * FROM empresas WHERE id=$1', [req.params.id]);
    if (eRes.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const e = eRes.rows[0];
    const uRes = await db.query(
      'SELECT id, nome, email, papel, criado_em FROM usuarios WHERE empresa_id=$1 ORDER BY nome',
      [req.params.id]
    );
    const pRes = await db.query(
      'SELECT * FROM pagamentos WHERE empresa_id=$1 ORDER BY data_pagamento DESC LIMIT 50',
      [req.params.id]
    );
    res.json({
      empresa: { ...camelizar(e), dataVencimento: formatarDataIso(e.data_vencimento) },
      usuarios: uRes.rows.map(camelizar),
      pagamentos: pRes.rows.map(p => ({
        ...camelizar(p),
        dataPagamento: formatarDataIso(p.data_pagamento),
        novoVencimento: formatarDataIso(p.novo_vencimento)
      }))
    });
  } catch (err) {
    console.error('[master/empresas/get]', err);
    res.status(500).json({ error: 'Erro ao carregar detalhes.' });
  }
});

// Atualizar empresa (status, plano, vencimento, mensalidade, observação)
router.put('/empresas/:id', async (req, res) => {
  const { status, plano, dataVencimento, valorMensalidade, observacao, nome, moduloFiscalAtivo } = req.body || {};
  // Valida valores
  const statusValidos = ['trial', 'ativa', 'vencida', 'bloqueada'];
  const planosValidos = ['trial', 'mensal', 'anual'];
  if (status && !statusValidos.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  if (plano && !planosValidos.includes(plano)) return res.status(400).json({ error: 'Plano inválido.' });
  try {
    // Se moduloFiscalAtivo foi enviado, ajusta também o moduloFiscalAtivadoEm
    // Quando ativa: registra data atual; quando desativa: mantém histórico (não apaga)
    let setModuloFiscal = '';
    if (moduloFiscalAtivo === true || moduloFiscalAtivo === false) {
      setModuloFiscal = `,
         modulo_fiscal_ativo = $8,
         modulo_fiscal_ativado_em = CASE WHEN $8 = TRUE AND modulo_fiscal_ativo = FALSE THEN NOW() ELSE modulo_fiscal_ativado_em END`;
    }
    const params = [
      nome || null, status || null, plano || null, dataVencimento || null,
      valorMensalidade != null ? Number(valorMensalidade) : null,
      observacao != null ? observacao : null,
      req.params.id
    ];
    if (setModuloFiscal) params.push(moduloFiscalAtivo);
    const r = await db.query(
      `UPDATE empresas SET
         nome = COALESCE($1, nome),
         status = COALESCE($2, status),
         plano = COALESCE($3, plano),
         data_vencimento = COALESCE($4, data_vencimento),
         valor_mensalidade = COALESCE($5, valor_mensalidade),
         observacao = COALESCE($6, observacao)
         ${setModuloFiscal}
       WHERE id=$7 RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    res.json({ ...camelizar(r.rows[0]), dataVencimento: formatarDataIso(r.rows[0].data_vencimento) });
  } catch (err) {
    console.error('[master/empresas/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar empresa.' });
  }
});

// Bloquear empresa (atalho)
router.post('/empresas/:id/bloquear', async (req, res) => {
  try {
    const r = await db.query(
      "UPDATE empresas SET status='bloqueada' WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    res.json({ ...camelizar(r.rows[0]), dataVencimento: formatarDataIso(r.rows[0].data_vencimento) });
  } catch (err) {
    console.error('[master/empresas/bloquear]', err);
    res.status(500).json({ error: 'Erro ao bloquear.' });
  }
});

// Desbloquear empresa (volta ao status correto baseado em vencimento)
router.post('/empresas/:id/desbloquear', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM empresas WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const e = r.rows[0];
    const hoje = new Date().toISOString().slice(0, 10);
    const venc = formatarDataIso(e.data_vencimento);
    let novoStatus = 'ativa';
    if (venc && venc < hoje) novoStatus = 'vencida';
    else if (e.plano === 'trial') novoStatus = 'trial';
    const upd = await db.query(
      'UPDATE empresas SET status=$1 WHERE id=$2 RETURNING *',
      [novoStatus, req.params.id]
    );
    res.json({ ...camelizar(upd.rows[0]), dataVencimento: formatarDataIso(upd.rows[0].data_vencimento) });
  } catch (err) {
    console.error('[master/empresas/desbloquear]', err);
    res.status(500).json({ error: 'Erro ao desbloquear.' });
  }
});

// Registrar pagamento (estende vencimento conforme plano)
router.post('/empresas/:id/pagamentos', async (req, res) => {
  const { valor, dataPagamento, plano, formaPagamento, observacao } = req.body || {};
  if (!valor || valor <= 0) return res.status(400).json({ error: 'Valor inválido.' });
  if (!dataPagamento) return res.status(400).json({ error: 'Data de pagamento é obrigatória.' });
  if (!plano || !['mensal', 'anual'].includes(plano)) return res.status(400).json({ error: 'Plano deve ser mensal ou anual.' });

  const meses = plano === 'anual' ? 12 : 1;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const eRes = await client.query('SELECT * FROM empresas WHERE id=$1', [req.params.id]);
    if (eRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Empresa não encontrada.' }); }
    const e = eRes.rows[0];

    // Calcula novo vencimento: a partir do maior entre (vencimento atual, hoje)
    const hoje = new Date().toISOString().slice(0, 10);
    const vencAtual = formatarDataIso(e.data_vencimento) || hoje;
    const base = vencAtual > hoje ? vencAtual : hoje;
    const baseDate = new Date(base + 'T12:00:00');
    baseDate.setMonth(baseDate.getMonth() + meses);
    const novoVenc = baseDate.toISOString().slice(0, 10);

    // Atualiza empresa
    await client.query(
      `UPDATE empresas SET status='ativa', plano=$1, data_vencimento=$2,
              valor_mensalidade = COALESCE($3, valor_mensalidade)
       WHERE id=$4`,
      [plano, novoVenc, plano === 'mensal' ? Number(valor) : Number(valor) / 12, req.params.id]
    );

    // Insere pagamento
    const pIns = await client.query(
      `INSERT INTO pagamentos (empresa_id, valor, data_pagamento, plano_aplicado, meses_adicionados,
                               novo_vencimento, forma_pagamento, observacao, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, Number(valor), dataPagamento, plano, meses, novoVenc,
       formaPagamento || null, observacao || null, req.master.masterId]
    );

    await client.query('COMMIT');
    res.json({
      pagamento: {
        ...camelizar(pIns.rows[0]),
        dataPagamento: formatarDataIso(pIns.rows[0].data_pagamento),
        novoVencimento: formatarDataIso(pIns.rows[0].novo_vencimento)
      },
      novoVencimento: novoVenc,
      mesesAdicionados: meses
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[master/pagamentos/create]', err);
    res.status(500).json({ error: 'Erro ao registrar pagamento.' });
  } finally {
    client.release();
  }
});

// Excluir empresa (cuidado!)
router.delete('/empresas/:id', async (req, res) => {
  try {
    const r = await db.query('DELETE FROM empresas WHERE id=$1 RETURNING id, nome', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    res.json({ ok: true, empresa: r.rows[0] });
  } catch (err) {
    console.error('[master/empresas/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir empresa.' });
  }
});

// === POST /api/master/empresas/:id/acessar === Acesso de suporte
// Gera um token JWT temporário (papel admin) pra entrar no sistema da empresa.
// Registra log de auditoria em master_acessos.
router.post('/empresas/:id/acessar', async (req, res) => {
  const empresaId = parseInt(req.params.id);
  if (!empresaId) return res.status(400).json({ error: 'ID inválido.' });
  const { motivo } = req.body || {};
  try {
    // Busca a empresa
    const rEmp = await db.query(
      'SELECT id, nome FROM empresas WHERE id = $1 LIMIT 1',
      [empresaId]
    );
    if (rEmp.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    const empresa = rEmp.rows[0];

    // Pega o primeiro admin da empresa (pra usar como contexto)
    const rAdm = await db.query(
      `SELECT id, email, nome FROM usuarios
       WHERE empresa_id = $1 AND papel = 'admin'
       ORDER BY id LIMIT 1`,
      [empresaId]
    );
    if (rAdm.rows.length === 0) {
      return res.status(404).json({ error: 'A empresa não possui usuário admin para acesso.' });
    }
    const admin = rAdm.rows[0];

    // Gera token JWT como se fosse o admin, mas com flag _master_support = true
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      {
        userId: admin.id,
        empresaId: empresaId,
        papel: 'admin',
        _master_support: true,
        _master_id: req.master?.id || null
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' } // Sessão de suporte expira em 2h
    );

    // Registra log de auditoria
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;
    await db.query(
      `INSERT INTO master_acessos (empresa_id, master_id, master_email, motivo, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [empresaId, req.master?.id || null, req.master?.email || null, motivo || null, ip, userAgent]
    );

    console.log(`[master/acessar] Master ${req.master?.email || '?'} acessou empresa ${empresaId} (${empresa.nome})`);

    res.json({
      ok: true,
      token,
      usuario: { id: admin.id, nome: admin.nome, email: admin.email, papel: 'admin' },
      empresa: { id: empresa.id, nome: empresa.nome },
      modoSuporte: true
    });
  } catch (err) {
    console.error('[master/acessar]', err);
    res.status(500).json({ error: 'Erro ao gerar acesso de suporte.' });
  }
});

// === GET /api/master/empresas/:id/historico-acessos === Histórico de quem acessou a empresa
router.get('/empresas/:id/historico-acessos', async (req, res) => {
  const empresaId = parseInt(req.params.id);
  if (!empresaId) return res.status(400).json({ error: 'ID inválido.' });
  try {
    const r = await db.query(
      `SELECT id, master_email, motivo, ip, acessado_em
       FROM master_acessos
       WHERE empresa_id = $1
       ORDER BY acessado_em DESC LIMIT 50`,
      [empresaId]
    );
    res.json(r.rows.map(camelizar));
  } catch (err) {
    console.error('[master/historico-acessos]', err);
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

// Cria uma EMPRESA EXTRA pra um usuário existente (multi-empresa)
// Pega o usuário admin de uma empresa origem e cria uma cópia dele numa nova empresa
router.post('/empresas/:id/criar-empresa-extra', async (req, res) => {
  const empresaOrigemId = parseInt(req.params.id);
  const { nomeNovaEmpresa, cnpj } = req.body || {};
  if (!nomeNovaEmpresa || nomeNovaEmpresa.trim().length < 2) {
    return res.status(400).json({ error: 'Informe o nome da nova empresa.' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Busca o admin da empresa origem (pra clonar)
    const adminQ = await client.query(
      `SELECT id, nome, email, senha_hash, grupo_id
       FROM usuarios
       WHERE empresa_id = $1 AND papel = 'admin'
       ORDER BY id ASC LIMIT 1`,
      [empresaOrigemId]
    );
    if (adminQ.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Empresa origem não tem admin.' });
    }
    const adminOrigem = adminQ.rows[0];

    // 2) Gera ou reaproveita grupo_id
    let grupoId = adminOrigem.grupo_id;
    if (!grupoId) {
      grupoId = 'grp_' + crypto.randomBytes(8).toString('hex');
      // Atualiza o admin origem com o grupo_id
      await client.query(
        'UPDATE usuarios SET grupo_id = $1 WHERE id = $2',
        [grupoId, adminOrigem.id]
      );
    }

    // 3) Verifica se já existe outro usuário com mesmo email em outra empresa (evita duplicata)
    const jaTemQ = await client.query(
      `SELECT u.empresa_id, e.nome AS empresa_nome
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = LOWER($1) AND u.empresa_id != $2`,
      [adminOrigem.email, empresaOrigemId]
    );
    const empresasExistentes = jaTemQ.rows.map(r => r.empresa_nome);

    // 4) Cria a nova empresa (status trial por padrão; master pode ajustar depois)
    const dataVenc = new Date();
    dataVenc.setDate(dataVenc.getDate() + 7);
    const novaEmpresaQ = await client.query(
      `INSERT INTO empresas (nome, cnpj, status, plano, data_vencimento, valor_mensalidade, origem)
       VALUES ($1, $2, 'trial', 'trial', $3, 0, 'master-multi-empresa')
       RETURNING *`,
      [nomeNovaEmpresa.trim(), cnpj || null, dataVenc.toISOString().slice(0, 10)]
    );
    const novaEmpresa = novaEmpresaQ.rows[0];

    // 5) Clona o admin pra nova empresa (mesma senha, mesmo grupo_id)
    await client.query(
      `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel, grupo_id)
       VALUES ($1, $2, $3, $4, 'admin', $5)`,
      [novaEmpresa.id, adminOrigem.email, adminOrigem.nome, adminOrigem.senha_hash, grupoId]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      empresaNova: {
        id: novaEmpresa.id,
        nome: novaEmpresa.nome,
        status: novaEmpresa.status
      },
      grupoId,
      emailDoAdmin: adminOrigem.email,
      empresasNoGrupo: [empresaOrigemId, ...jaTemQ.rows.map(r => r.empresa_id), novaEmpresa.id],
      avisoEmpresasExistentes: empresasExistentes.length > 0
        ? `Atenção: este e-mail já tem acesso a: ${empresasExistentes.join(', ')}. Agora também terá a ${nomeNovaEmpresa}.`
        : null
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[master/criar-empresa-extra]', err);
    res.status(500).json({ error: 'Erro ao criar empresa extra: ' + err.message });
  } finally {
    client.release();
  }
});

// Lista empresas do grupo de um usuário (pra ver multi-empresa no master)
router.get('/empresas/:id/grupo', async (req, res) => {
  const empresaId = parseInt(req.params.id);
  try {
    // Pega o email do admin desta empresa
    const adminQ = await db.query(
      `SELECT email, grupo_id FROM usuarios
       WHERE empresa_id = $1 AND papel = 'admin' LIMIT 1`,
      [empresaId]
    );
    if (adminQ.rows.length === 0) return res.json({ empresas: [] });
    const email = adminQ.rows[0].email;

    // Lista todas as empresas onde esse email tem acesso
    const r = await db.query(
      `SELECT e.id, e.nome, e.status, e.plano, e.valor_mensalidade,
              COALESCE(e.modulo_fiscal_ativo, false) AS modulo_fiscal_ativo
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = LOWER($1)
       ORDER BY e.nome ASC`,
      [email]
    );
    res.json({
      email,
      empresas: r.rows.map(camelizar)
    });
  } catch (err) {
    console.error('[master/grupo]', err);
    res.status(500).json({ error: 'Erro ao listar grupo.' });
  }
});

module.exports = router;
