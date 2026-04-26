// Servidor principal: serve a API REST e os arquivos estáticos do frontend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { autenticar, autenticarMaster } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Rotas públicas (sem auth)
app.use('/api/auth', require('./routes/auth'));

// Rotas protegidas (token de empresa)
app.use('/api/produtos',        autenticar, require('./routes/produtos'));
app.use('/api/clientes',        autenticar, require('./routes/clientes'));
app.use('/api/fornecedores',    autenticar, require('./routes/fornecedores'));
app.use('/api/vendas',          autenticar, require('./routes/vendas'));
app.use('/api/entradas',        autenticar, require('./routes/entradas'));
app.use('/api/contas-pagar',    autenticar, require('./routes/contas-pagar'));
app.use('/api/contas-receber',  autenticar, require('./routes/contas-receber'));
app.use('/api/usuarios',        autenticar, require('./routes/usuarios'));
app.use('/api/empresa',         autenticar, require('./routes/empresa'));

// Rotas Master (token Master)
app.use('/api/master', autenticarMaster, require('./routes/master'));

// Healthcheck (Render usa)
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Frontend estático
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
