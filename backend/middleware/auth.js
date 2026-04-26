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

module.exports = { autenticar, autenticarMaster, exigirAdmin, gerarToken, gerarTokenMaster };
