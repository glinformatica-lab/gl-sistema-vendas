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
        dataVencimento: vencIso
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
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  try {
    const result = await db.query(
      `SELECT u.*, e.id AS emp_id, e.nome AS empresa_nome, e.status AS empresa_status,
              e.plano, e.data_vencimento
       FROM usuarios u
       JOIN empresas e ON e.id = u.empresa_id
       WHERE u.email = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    const usuario = result.rows[0];
    if (!usuario) return res.status(401).json({ error: 'Credenciais inválidas.' });
    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    // Verifica licença
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
        dataVencimento: venc
      }
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
              e.status AS empresa_status, e.plano, e.data_vencimento
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
      empresa: { id: u.empresa_id, nome: u.empresa_nome, status: u.empresa_status, plano: u.plano, dataVencimento: venc }
    });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }
});

module.exports = router;
