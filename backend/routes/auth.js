// Rotas de autenticação:
// - POST /api/auth/registrar-empresa — cria empresa em trial de 7 dias + admin
// - POST /api/auth/login — autentica usuário e retorna JWT (bloqueia se licença vencida/bloqueada)
// - POST /api/auth/login-master — autentica usuário Master
// - GET /api/auth/me — devolve dados do usuário logado
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { autenticar, gerarToken, gerarTokenMaster } = require('../middleware/auth');

const router = express.Router();

// Verifica se a licença da empresa está válida e atualiza status se necessário
// Retorna { ok: true } ou { ok: false, error: '...' }
async function verificarLicenca(empresa, dbClient) {
  const cliente = dbClient || db;
  if (empresa.status === 'bloqueada') {
    return { ok: false, error: 'Esta empresa está bloqueada. Entre em contato com o suporte.' };
  }
  if (empresa.status === 'aguardando-pagamento') {
    return { ok: false, error: 'Sua assinatura ainda não foi confirmada. Após o pagamento, o acesso é liberado em poucos minutos. Em caso de dúvidas, entre em contato pelo WhatsApp (62) 99234-7572.' };
  }
  if (empresa.status === 'cancelada') {
    return { ok: false, error: 'Esta assinatura foi cancelada. Entre em contato com o suporte para reativar.' };
  }
  // Se tiver data_vencimento e estiver no passado, marca como vencida
  if (empresa.data_vencimento) {
    const hoje = new Date().toISOString().slice(0, 10);
    const venc = empresa.data_vencimento instanceof Date
      ? empresa.data_vencimento.toISOString().slice(0, 10)
      : String(empresa.data_vencimento).slice(0, 10);
    if (venc < hoje) {
      // Marca como vencida (se já não estiver)
      if (empresa.status !== 'vencida') {
        await cliente.query("UPDATE empresas SET status='vencida' WHERE id=$1", [empresa.id]);
      }
      const msg = empresa.status === 'trial' || empresa.plano === 'trial'
        ? `Seu período de teste expirou em ${venc.split('-').reverse().join('/')}. Entre em contato com o suporte para contratar o plano.`
        : `Sua licença expirou em ${venc.split('-').reverse().join('/')}. Entre em contato com o suporte para renovar.`;
      return { ok: false, error: msg };
    }
  }
  return { ok: true };
}

// Registra empresa nova + primeiro usuário (admin) — com trial de 7 dias
router.post('/registrar-empresa', async (req, res) => {
  const { empresa, cnpj, nome, email, senha } = req.body || {};
  if (!empresa || !nome || !email || !senha) {
    return res.status(400).json({ error: 'Preencha empresa, nome, email e senha.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Trial de 7 dias
    const dataVencimento = new Date();
    dataVencimento.setDate(dataVencimento.getDate() + 7);
    const vencIso = dataVencimento.toISOString().slice(0, 10);

    const empResult = await client.query(
      `INSERT INTO empresas (nome, cnpj, status, plano, data_vencimento)
       VALUES ($1, $2, 'trial', 'trial', $3) RETURNING *`,
      [empresa, cnpj || null, vencIso]
    );
    const novaEmpresa = empResult.rows[0];

    const senhaHash = await bcrypt.hash(senha, 10);
    const userResult = await client.query(
      `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING *`,
      [novaEmpresa.id, email.toLowerCase().trim(), nome, senhaHash]
    );
    const novoUsuario = userResult.rows[0];

    await client.query('COMMIT');
    const token = gerarToken(novoUsuario);
    res.json({
      token,
      usuario: { id: novoUsuario.id, nome: novoUsuario.nome, email: novoUsuario.email, papel: novoUsuario.papel },
      empresa: {
        id: novaEmpresa.id, nome: novaEmpresa.nome,
        status: novaEmpresa.status, plano: novaEmpresa.plano,
        dataVencimento: vencIso,
        moduloFiscalAtivo: false
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ error: 'Já existe um usuário com esse e-mail nessa empresa.' });
    console.error('[auth/registrar]', err);
    res.status(500).json({ error: 'Erro ao registrar empresa.' });
  } finally {
    client.release();
  }
});

// Login (empresa)
router.post('/login', async (req, res) => {
  const { email, senha, empresaId } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  try {
    // Busca TODOS os usuarios com esse e-mail (pode ser multi-empresa via grupo_id)
    const resultTodos = await db.query(
      `SELECT u.*, e.id AS emp_id, e.nome AS empresa_nome, e.status AS empresa_status,
              e.plano, e.data_vencimento,
              COALESCE(e.modulo_fiscal_ativo, false) AS modulo_fiscal_ativo
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = $1
       ORDER BY u.id ASC`,
      [email.toLowerCase().trim()]
    );

    if (resultTodos.rows.length === 0) return res.status(401).json({ error: 'Credenciais inválidas.' });

    // Confere senha contra o primeiro usuário (todos têm a mesma senha quando estão no mesmo grupo)
    const primeiro = resultTodos.rows[0];
    const ok = await bcrypt.compare(senha, primeiro.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    // Se múltiplas empresas E cliente não escolheu ainda → retorna lista pra escolher
    const empresasAtivas = resultTodos.rows.filter(u => {
      // Só lista empresas em situação saudável (não bloqueada/cancelada)
      return u.empresa_status !== 'cancelada' && u.empresa_status !== 'bloqueada';
    });

    if (empresasAtivas.length > 1 && !empresaId) {
      return res.json({
        precisaEscolherEmpresa: true,
        empresas: empresasAtivas.map(u => ({
          id: u.empresa_id,
          nome: u.empresa_nome,
          plano: u.plano,
          status: u.empresa_status,
          moduloFiscalAtivo: !!u.modulo_fiscal_ativo
        }))
      });
    }

    // Se cliente escolheu uma empresa específica, valida que ela está no grupo
    let usuario;
    if (empresaId) {
      usuario = resultTodos.rows.find(u => u.empresa_id === parseInt(empresaId));
      if (!usuario) return res.status(403).json({ error: 'Você não tem acesso a essa empresa.' });
    } else {
      // 1 empresa só → usa o primeiro mesmo
      usuario = primeiro;
    }

    // Verifica licença da empresa escolhida
    const lic = await verificarLicenca({
      id: usuario.empresa_id, status: usuario.empresa_status,
      plano: usuario.plano, data_vencimento: usuario.data_vencimento
    });
    if (!lic.ok) return res.status(403).json({ error: lic.error });

    const token = gerarToken(usuario);
    const venc = usuario.data_vencimento
      ? (usuario.data_vencimento instanceof Date
          ? usuario.data_vencimento.toISOString().slice(0,10)
          : String(usuario.data_vencimento).slice(0,10))
      : null;
    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
      empresa: {
        id: usuario.empresa_id, nome: usuario.empresa_nome,
        status: usuario.empresa_status, plano: usuario.plano,
        dataVencimento: venc,
        moduloFiscalAtivo: !!usuario.modulo_fiscal_ativo
      },
      // Informa se o cliente tem outras empresas (pra mostrar botão "Trocar Empresa")
      temMultiEmpresa: empresasAtivas.length > 1
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Erro ao autenticar.' });
  }
});

// Login Master (separado)
router.post('/login-master', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  try {
    const result = await db.query(
      'SELECT * FROM master_usuarios WHERE email=$1 LIMIT 1',
      [email.toLowerCase().trim()]
    );
    const m = result.rows[0];
    if (!m) return res.status(401).json({ error: 'Credenciais inválidas.' });
    const ok = await bcrypt.compare(senha, m.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    await db.query('UPDATE master_usuarios SET ultimo_login=NOW() WHERE id=$1', [m.id]);

    const token = gerarTokenMaster(m);
    res.json({
      token,
      master: { id: m.id, nome: m.nome, email: m.email }
    });
  } catch (err) {
    console.error('[auth/login-master]', err);
    res.status(500).json({ error: 'Erro ao autenticar.' });
  }
});

// Dados do usuário autenticado
router.get('/me', autenticar, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.nome, u.email, u.papel,
              e.id AS empresa_id, e.nome AS empresa_nome,
              e.status AS empresa_status, e.plano, e.data_vencimento,
              COALESCE(e.modulo_fiscal_ativo, false) AS modulo_fiscal_ativo,
              e.modulo_fiscal_ativado_em
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = $1 LIMIT 1`,
      [req.user.userId]
    );
    const u = result.rows[0];
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const venc = u.data_vencimento
      ? (u.data_vencimento instanceof Date
          ? u.data_vencimento.toISOString().slice(0,10)
          : String(u.data_vencimento).slice(0,10))
      : null;
    res.json({
      usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel },
      empresa: {
        id: u.empresa_id,
        nome: u.empresa_nome,
        status: u.empresa_status,
        plano: u.plano,
        dataVencimento: venc,
        moduloFiscalAtivo: !!u.modulo_fiscal_ativo,
        moduloFiscalAtivadoEm: u.modulo_fiscal_ativado_em
      }
    });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }
});

router.put('/me/senha', autenticar, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body || {};
  if (!senhaAtual || !novaSenha) return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias.' });
  if (String(novaSenha).length < 6) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  try {
    const r = await db.query('SELECT senha_hash FROM usuarios WHERE id=$1 LIMIT 1', [req.user.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const ok = await bcrypt.compare(senhaAtual, r.rows[0].senha_hash);
    if (!ok) return res.status(400).json({ error: 'Senha atual incorreta.' });
    const novoHash = await bcrypt.hash(novaSenha, 10);
    await db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', [novoHash, req.user.userId]);
    res.json({ ok: true, mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error('[auth/me/senha]', err);
    res.status(500).json({ error: 'Erro ao trocar a senha.' });
  }
});

// Lista as empresas do grupo do usuário (pra trocar de empresa)
router.get('/minhas-empresas', autenticar, async (req, res) => {
  try {
    // Pega o email do usuário atual
    const meQ = await db.query('SELECT email FROM usuarios WHERE id = $1', [req.user.userId]);
    if (meQ.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const email = meQ.rows[0].email;

    // Lista todas as empresas onde o cliente tem usuário ativo
    const result = await db.query(
      `SELECT u.id AS usuario_id, u.papel,
              e.id AS empresa_id, e.nome AS empresa_nome,
              e.status AS empresa_status, e.plano,
              COALESCE(e.modulo_fiscal_ativo, false) AS modulo_fiscal_ativo
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = LOWER($1)
         AND e.status NOT IN ('cancelada', 'bloqueada')
       ORDER BY e.nome ASC`,
      [email]
    );
    res.json({
      atual: req.user.empresaId,
      empresas: result.rows.map(r => ({
        empresaId: r.empresa_id,
        nome: r.empresa_nome,
        plano: r.plano,
        status: r.empresa_status,
        papel: r.papel,
        moduloFiscalAtivo: !!r.modulo_fiscal_ativo
      }))
    });
  } catch (err) {
    console.error('[auth/minhas-empresas]', err);
    res.status(500).json({ error: 'Erro ao listar empresas.' });
  }
});

// Troca pra outra empresa do mesmo cliente (gera novo JWT)
router.post('/trocar-empresa', autenticar, async (req, res) => {
  const { empresaId } = req.body || {};
  if (!empresaId) return res.status(400).json({ error: 'Empresa não informada.' });
  try {
    // Pega o email atual
    const meQ = await db.query('SELECT email FROM usuarios WHERE id = $1', [req.user.userId]);
    if (meQ.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const email = meQ.rows[0].email;

    // Busca o usuário equivalente na empresa destino
    const r = await db.query(
      `SELECT u.*, e.id AS emp_id, e.nome AS empresa_nome, e.status AS empresa_status,
              e.plano, e.data_vencimento,
              COALESCE(e.modulo_fiscal_ativo, false) AS modulo_fiscal_ativo
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = LOWER($1) AND u.empresa_id = $2 LIMIT 1`,
      [email, parseInt(empresaId)]
    );
    if (r.rows.length === 0) return res.status(403).json({ error: 'Você não tem acesso a essa empresa.' });
    const usuario = r.rows[0];

    // Valida licença da empresa destino
    const lic = await verificarLicenca({
      id: usuario.empresa_id, status: usuario.empresa_status,
      plano: usuario.plano, data_vencimento: usuario.data_vencimento
    });
    if (!lic.ok) return res.status(403).json({ error: lic.error });

    const token = gerarToken(usuario);
    const venc = usuario.data_vencimento
      ? (usuario.data_vencimento instanceof Date
          ? usuario.data_vencimento.toISOString().slice(0,10)
          : String(usuario.data_vencimento).slice(0,10))
      : null;
    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
      empresa: {
        id: usuario.empresa_id, nome: usuario.empresa_nome,
        status: usuario.empresa_status, plano: usuario.plano,
        dataVencimento: venc,
        moduloFiscalAtivo: !!usuario.modulo_fiscal_ativo
      },
      temMultiEmpresa: true
    });
  } catch (err) {
    console.error('[auth/trocar-empresa]', err);
    res.status(500).json({ error: 'Erro ao trocar de empresa.' });
  }
});

module.exports = router;
