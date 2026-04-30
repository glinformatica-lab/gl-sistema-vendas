// Middleware de autenticação JWT.
// Suporta dois tipos de token:
//   - Token de empresa: payload tem userId + empresaId + papel ('admin' | 'vendedor')
//   - Token Master: payload tem tipo:'master' + masterId
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[auth] AVISO: JWT_SECRET não definido no .env — defina antes de rodar em produção.');
}

function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Token ausente.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET || 'dev-secret');
    if (payload.tipo === 'master') {
      return res.status(403).json({ error: 'Use o painel Master para esta ação.' });
    }
    req.user = {
      userId: payload.userId,
      empresaId: payload.empresaId,
      papel: payload.papel,
      nome: payload.nome,
      email: payload.email
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function autenticarMaster(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Token ausente.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET || 'dev-secret');
    if (payload.tipo !== 'master') {
      return res.status(403).json({ error: 'Acesso restrito ao Master.' });
    }
    req.master = {
      masterId: payload.masterId,
      nome: payload.nome,
      email: payload.email
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

function exigirAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
}

// Middleware: bloqueia operações de escrita (POST, PUT, DELETE, PATCH)
// para empresas com trial expirado ou licença vencida.
// Permite apenas GET (leitura).
const db = require('../db');
async function verificarAcesso(req, res, next) {
  // Só verifica em métodos de escrita
  const metodosEscrita = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!metodosEscrita.includes(req.method)) {
    return next();
  }
  // Endpoints sempre liberados (auth, leitura própria, sair, etc.)
  const url = req.originalUrl || req.url || '';
  const liberados = [
    '/api/auth/me',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/me/senha',
    '/api/empresa/pagamentos'
  ];
  if (liberados.some(l => url.startsWith(l))) {
    return next();
  }
  try {
    const r = await db.query(
      'SELECT status, plano, data_vencimento FROM empresas WHERE id = $1 LIMIT 1',
      [req.user.empresaId]
    );
    if (r.rows.length === 0) {
      return res.status(403).json({ error: 'Empresa não encontrada.' });
    }
    const emp = r.rows[0];
    // Status que bloqueiam escrita
    if (emp.status === 'bloqueada') {
      return res.status(403).json({
        error: 'Sua conta está bloqueada. Entre em contato com o suporte.',
        codigo: 'CONTA_BLOQUEADA'
      });
    }
    if (emp.status === 'trial-expirado') {
      return res.status(403).json({
        error: 'Seu período de teste expirou. Assine um plano para continuar.',
        codigo: 'TRIAL_EXPIRADO',
        modoLeitura: true
      });
    }
    if (emp.status === 'vencida') {
      return res.status(403).json({
        error: 'Sua mensalidade está vencida. Renove para continuar usando o sistema.',
        codigo: 'MENSALIDADE_VENCIDA',
        modoLeitura: true
      });
    }
    next();
  } catch (err) {
    console.error('[verificarAcesso]', err);
    next(); // Em caso de erro no DB, deixa passar pra não travar o sistema
  }
}

function gerarToken(usuario) {
  return jwt.sign(
    {
      userId: usuario.id,
      empresaId: usuario.empresa_id,
      papel: usuario.papel,
      nome: usuario.nome,
      email: usuario.email
    },
    JWT_SECRET || 'dev-secret',
    { expiresIn: '7d' }
  );
}

function gerarTokenMaster(master) {
  return jwt.sign(
    {
      tipo: 'master',
      masterId: master.id,
      nome: master.nome,
      email: master.email
    },
    JWT_SECRET || 'dev-secret',
    { expiresIn: '7d' }
  );
}

module.exports = { autenticar, autenticarMaster, exigirAdmin, gerarToken, gerarTokenMaster, verificarAcesso };
