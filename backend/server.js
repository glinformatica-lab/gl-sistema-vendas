// Servidor principal: serve a API REST e os arquivos estáticos do frontend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { autenticar, autenticarMaster, verificarAcesso } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Rotas públicas (sem auth)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/assinaturas', require('./routes/assinaturas'));

// Rotas protegidas (token de empresa)
app.use('/api/produtos',        autenticar, verificarAcesso, require('./routes/produtos'));
app.use('/api/servicos',        autenticar, verificarAcesso, require('./routes/servicos'));
app.use('/api/orcamentos',      autenticar, verificarAcesso, require('./routes/orcamentos'));
app.use('/api/clientes',        autenticar, verificarAcesso, require('./routes/clientes'));
app.use('/api/fornecedores',    autenticar, verificarAcesso, require('./routes/fornecedores'));
app.use('/api/vendas',          autenticar, verificarAcesso, require('./routes/vendas'));
app.use('/api/entradas',        autenticar, verificarAcesso, require('./routes/entradas'));
app.use('/api/contas-pagar',    autenticar, verificarAcesso, require('./routes/contas-pagar'));
app.use('/api/contas-receber',  autenticar, verificarAcesso, require('./routes/contas-receber'));
app.use('/api/usuarios',        autenticar, verificarAcesso, require('./routes/usuarios'));
app.use('/api/empresa',         autenticar, verificarAcesso, require('./routes/empresa'));
app.use('/api/caixa',           autenticar, verificarAcesso, require('./routes/caixa'));

// Rotas Master (token Master)
app.use('/api/master', autenticarMaster, require('./routes/master'));

// Healthcheck (Render usa)
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// URLs amigáveis (sem .html)
app.get('/assinar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assinar.html')));
app.get('/assinatura-sucesso', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assinatura-sucesso.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/renovar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'renovar.html')));
app.get('/reset-senha', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-senha.html')));
app.get('/master', (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));

// Frontend estático
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  // Inicia jobs em background (verificação de trials e licenças)
  try {
    require('./services/jobs').iniciarJobs();
    console.log('[jobs] Inicializados.');
  } catch (e) {
    console.error('[jobs] Erro ao inicializar:', e.message);
  }
});
