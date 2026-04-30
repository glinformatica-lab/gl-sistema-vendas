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
              e.status AS empresa_status, e.plano, e.data_vencimento,
              e.origem, e.valor_mensalidade
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
        origem: u.origem || 'manual',
        valorMensalidade: u.valor_mensalidade != null ? Number(u.valor_mensalidade) : null
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

// === POST /esqueci-senha === Solicita reset de senha
// Body: { email }
// Resposta: sempre { ok: true } (não revela se e-mail existe — segurança)
router.post('/esqueci-senha', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }
  const emailNorm = email.trim().toLowerCase();
  try {
    // Busca usuário pelo e-mail
    const r = await db.query(
      `SELECT u.id, u.nome, u.email, e.nome AS empresa_nome
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE LOWER(u.email) = $1 LIMIT 1`,
      [emailNorm]
    );
    // Se não achou, fingimos que deu certo (segurança - não vaza se e-mail existe)
    if (r.rows.length === 0) {
      console.log(`[esqueci-senha] E-mail não encontrado: ${emailNorm}`);
      return res.json({ ok: true });
    }
    const usuario = r.rows[0];
    // Gera token aleatório de 64 chars (criptograficamente seguro)
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiraEm = new Date(Date.now() + 60 * 60 * 1000); // +1 hora
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || null;
    // Invalida tokens antigos do mesmo usuário (limpeza)
    await db.query(
      `UPDATE reset_senha_tokens SET usado = TRUE WHERE usuario_id = $1 AND usado = FALSE`,
      [usuario.id]
    );
    // Cria novo token
    await db.query(
      `INSERT INTO reset_senha_tokens (usuario_id, token, expira_em, ip)
       VALUES ($1, $2, $3, $4)`,
      [usuario.id, token, expiraEm, ip]
    );
    // Envia e-mail (não bloqueia o response - dispara em background)
    const APP_URL = process.env.APP_URL || 'https://sistema.glinformatica.com.br';
    const link = `${APP_URL}/reset-senha?token=${token}`;
    const { enviarEmail } = require('../services/email');
    enviarEmail({
      para: usuario.email,
      assunto: 'Redefinir senha — GL Sistema de Vendas',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1e3a8a, #3730a3); color: white; padding: 22px; border-radius: 12px 12px 0 0;">
            <h1 style="margin: 0; font-size: 20px;">🔑 Redefinição de senha</h1>
          </div>
          <div style="background: #fff; border: 1px solid #ddd; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
            <p>Olá, <strong>${usuario.nome}</strong>!</p>
            <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>GL Sistema de Vendas</strong> (${usuario.empresa_nome}).</p>
            <p>Clique no botão abaixo para definir uma nova senha:</p>
            <div style="text-align: center; margin: 26px 0;">
              <a href="${link}" style="background: #1e3a8a; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Redefinir minha senha</a>
            </div>
            <p style="color: #666; font-size: 13px;">Ou copie e cole este link no navegador:</p>
            <p style="word-break: break-all; background: #f6f8fc; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #445;">${link}</p>
            <div style="background: #fef3c7; border-left: 4px solid #ca8a04; padding: 12px; border-radius: 6px; margin-top: 18px; font-size: 13px;">
              ⚠️ <strong>Este link expira em 1 hora</strong> e só pode ser usado uma vez.
            </div>
            <p style="color: #666; font-size: 12px; margin-top: 22px; padding-top: 16px; border-top: 1px solid #eee;">
              Se você não solicitou esta redefinição, ignore este e-mail. Sua senha atual continua segura.
            </p>
          </div>
          <p style="text-align: center; color: #888; font-size: 11px; margin-top: 14px;">
            E-mail automático do GL Sistema de Vendas. Não responda este e-mail.
          </p>
        </div>
      `
    }).catch(e => console.error('[esqueci-senha] erro ao enviar e-mail:', e.message));
    console.log(`[esqueci-senha] Token gerado para ${emailNorm}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[esqueci-senha]', err);
    // Mesmo em erro, retornamos OK pra não vazar nada
    res.json({ ok: true });
  }
});

// === POST /resetar-senha === Aplica nova senha usando token
// Body: { token, novaSenha }
router.post('/resetar-senha', async (req, res) => {
  const { token, novaSenha } = req.body || {};
  if (!token || !novaSenha) {
    return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
  }
  if (String(novaSenha).length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }
  try {
    // Busca token válido (não usado, não expirado)
    const r = await db.query(
      `SELECT id, usuario_id FROM reset_senha_tokens
       WHERE token = $1 AND usado = FALSE AND expira_em > NOW() LIMIT 1`,
      [token]
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ error: 'Link inválido ou expirado. Solicite uma nova redefinição.' });
    }
    const tokenInfo = r.rows[0];
    // Atualiza senha
    const novoHash = await bcrypt.hash(novaSenha, 10);
    await db.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [novoHash, tokenInfo.usuario_id]);
    // Marca token como usado
    await db.query('UPDATE reset_senha_tokens SET usado = TRUE WHERE id = $1', [tokenInfo.id]);
    console.log(`[resetar-senha] Senha alterada para usuário ${tokenInfo.usuario_id}`);
    res.json({ ok: true, mensagem: 'Senha alterada com sucesso!' });
  } catch (err) {
    console.error('[resetar-senha]', err);
    res.status(500).json({ error: 'Erro ao processar a redefinição.' });
  }
});

// === GET /validar-token-reset?token=XXX === Verifica se token é válido (antes de mostrar form)
router.get('/validar-token-reset', async (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.json({ valido: false });
  try {
    const r = await db.query(
      `SELECT u.email FROM reset_senha_tokens t JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.token = $1 AND t.usado = FALSE AND t.expira_em > NOW() LIMIT 1`,
      [token]
    );
    if (r.rows.length === 0) return res.json({ valido: false });
    // Mascara e-mail (mostra só primeiro caractere + domínio)
    const email = r.rows[0].email;
    const [user, dom] = email.split('@');
    const emailMascarado = user[0] + '***@' + dom;
    res.json({ valido: true, email: emailMascarado });
  } catch (err) {
    console.error('[validar-token-reset]', err);
    res.json({ valido: false });
  }
});

module.exports = router;
