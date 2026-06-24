// Rotas públicas (SEM auth) para o fluxo de auto-assinatura.
// - POST /api/assinaturas/iniciar  — cria empresa + assinatura + checkout no PagBank
// - GET  /api/assinaturas/:ref     — consulta status de uma assinatura pela referência
// - POST /api/assinaturas/webhook  — recebe notificações do PagBank
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { gerarToken } = require('../middleware/auth');
const pagbank = require('../services/pagbank');

const router = express.Router();

// Configuração dos planos disponíveis
const PLANOS = {
  // === Planos principais ===
  basico:        { nome: 'Plano Básico',     valor: 99.90,   meses: 1,  modulosVendaOnline: false, moduloFiscal: false },
  pro:           { nome: 'Plano Pro',        valor: 149.90,  meses: 1,  modulosVendaOnline: true,  moduloFiscal: false },
  'pro-fiscal':  { nome: 'Plano Pro Fiscal', valor: 249.90,  meses: 1,  modulosVendaOnline: true,  moduloFiscal: true  },
  // === Plano anual (legado - mantido pra compatibilidade) ===
  anual:         { nome: 'Plano Anual',      valor: 1080.00, meses: 12, modulosVendaOnline: false, moduloFiscal: false },
  // === Plano de empresa extra (multi-empresa) ===
  'empresa-extra': { nome: 'Empresa Adicional', valor: 79.90, meses: 1, ehExtra: true }
};

// Helper: cria string única para reference_id
function gerarReferencia() {
  return 'ASSIN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Helper: valida e-mail simples
function emailValido(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// === POST /api/assinaturas/iniciar ===
// Body: { plano, empresa, cnpj?, telefone?, nomeAdmin, emailAdmin, senhaAdmin }
// Cria empresa em "aguardando-pagamento" + admin + assinatura + checkout PagBank.
router.post('/iniciar', async (req, res) => {
  const { plano, empresa, cnpj, telefone, nomeAdmin, emailAdmin, senhaAdmin } = req.body || {};

  // Validações de entrada
  if (!plano || !PLANOS[plano]) {
    return res.status(400).json({ error: 'Plano inválido. Use "basico", "pro" ou "pro-fiscal".' });
  }
  // Bloqueia novas contratações de Pro Fiscal (ainda em desenvolvimento - aguardando NFe)
  if (plano === 'pro-fiscal') {
    return res.status(400).json({
      error: 'O Plano Pro Fiscal está em desenvolvimento. Entre em contato com a GL Informática pelo WhatsApp pra ser avisado quando estiver disponível.'
    });
  }
  if (!empresa || !empresa.trim()) return res.status(400).json({ error: 'Informe o nome da empresa.' });
  if (!nomeAdmin || !nomeAdmin.trim()) return res.status(400).json({ error: 'Informe o nome do administrador.' });
  if (!emailValido(emailAdmin)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (!senhaAdmin || senhaAdmin.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });

  if (!pagbank.tokenConfigurado()) {
    return res.status(503).json({ error: 'Pagamento online temporariamente indisponível. Entre em contato pelo WhatsApp.' });
  }

  const planoConfig = PLANOS[plano];
  const referencia = gerarReferencia();

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica e-mail duplicado em qualquer empresa
    const dup = await client.query(
      'SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1) LIMIT 1',
      [emailAdmin.trim()]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Já existe um usuário com este e-mail. Use outro ou faça login.' });
    }

    // Cria empresa em "aguardando-pagamento" (origem = auto-assinatura)
    // Calcula o valor mensal (anual divide por 12, outros usam direto)
    const valorMensalCalc = planoConfig.meses > 1 ? (planoConfig.valor / planoConfig.meses) : planoConfig.valor;
    const empResult = await client.query(
      `INSERT INTO empresas (nome, cnpj, telefone, status, plano, valor_mensalidade, origem)
       VALUES ($1, $2, $3, 'aguardando-pagamento', $4, $5, 'auto-assinatura') RETURNING *`,
      [empresa.trim(), cnpj || null, telefone || null, plano,
       valorMensalCalc]
    );
    const novaEmpresa = empResult.rows[0];

    // Cria admin
    const senhaHash = await bcrypt.hash(senhaAdmin, 10);
    await client.query(
      `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [novaEmpresa.id, emailAdmin.toLowerCase().trim(), nomeAdmin.trim(), senhaHash]
    );

    // Cria registro de assinatura
    const assinResult = await client.query(
      `INSERT INTO assinaturas (empresa_id, referencia, plano, valor, status, email_contato)
       VALUES ($1, $2, $3, $4, 'pendente', $5) RETURNING *`,
      [novaEmpresa.id, referencia, plano, planoConfig.valor, emailAdmin.toLowerCase().trim()]
    );
    const novaAssinatura = assinResult.rows[0];

    // Chama API PagBank para criar checkout
    let checkout;
    try {
      checkout = await pagbank.criarCheckout({
        referencia,
        valor: planoConfig.valor,
        descricao: `${planoConfig.nome} — GL Sistema de Vendas`,
        email: emailAdmin,
        nome: nomeAdmin,
        formas: ['CREDIT_CARD', 'BOLETO', 'PIX'],
        maxParcelas: plano === 'anual' ? 12 : 1
      });
    } catch (err) {
      // Se PagBank falhar, faz rollback (deixa banco limpo)
      await client.query('ROLLBACK');
      console.error('[assinaturas/iniciar] Erro PagBank:', err.message, err.responseBody || '');
      return res.status(502).json({ error: 'Erro ao criar pagamento. Tente novamente em instantes.' });
    }

    // Atualiza assinatura com dados do checkout
    await client.query(
      `UPDATE assinaturas SET checkout_id=$1, link_pagamento=$2, payload_inicial=$3
       WHERE id=$4`,
      [checkout.checkoutId, checkout.linkPagamento, JSON.stringify(checkout.raw), novaAssinatura.id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      referencia,
      linkPagamento: checkout.linkPagamento,
      empresa: { id: novaEmpresa.id, nome: novaEmpresa.nome },
      plano,
      valor: planoConfig.valor
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[assinaturas/iniciar]', err);
    res.status(500).json({ error: 'Erro ao iniciar assinatura: ' + err.message });
  } finally {
    client.release();
  }
});

// === GET /api/assinaturas/:ref ===
// Consulta o status atual de uma assinatura. Usado pela página de retorno.
router.get('/:ref', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.*, e.nome AS empresa_nome
       FROM assinaturas a LEFT JOIN empresas e ON e.id = a.empresa_id
       WHERE a.referencia=$1 LIMIT 1`,
      [req.params.ref]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Assinatura não encontrada.' });
    const a = r.rows[0];

    // Se ainda pendente e tem checkout_id, consulta PagBank em tempo real
    if (a.status === 'pendente' && a.checkout_id && pagbank.tokenConfigurado()) {
      try {
        const dadosPb = await pagbank.consultarCheckout(a.checkout_id);
        const orders = dadosPb.orders || [];
        // O retorno do consultarCheckout só traz IDs dos pedidos (sem charges).
        // Precisamos consultar cada pedido individualmente para pegar o status.
        for (const orderResumo of orders) {
          if (!orderResumo.id) continue;
          try {
            const pedidoCompleto = await pagbank.consultarPedido(orderResumo.id);
            const charges = pedidoCompleto.charges || [];
            const chargePaga = charges.find(c => c.status === 'PAID');
            if (chargePaga) {
              await processarPagamento(a.referencia, pedidoCompleto);
              break; // já achou pagamento, não precisa olhar outros pedidos
            }
          } catch (errOrder) {
            console.warn('[assinaturas/get] erro consultando pedido', orderResumo.id, ':', errOrder.message);
          }
        }
      } catch (e) {
        console.warn('[assinaturas/get] erro ao consultar PagBank:', e.message);
      }
      // Re-busca do banco caso tenha sido atualizada
      const r2 = await db.query('SELECT * FROM assinaturas WHERE id=$1', [a.id]);
      if (r2.rows.length > 0) Object.assign(a, r2.rows[0]);
    }

    res.json({
      referencia: a.referencia,
      status: a.status,
      plano: a.plano,
      valor: Number(a.valor),
      empresaNome: a.empresa_nome,
      emailContato: a.email_contato,
      formaPagamento: a.forma_pagamento,
      dataPagamento: a.data_pagamento,
      linkPagamento: a.link_pagamento
    });
  } catch (err) {
    console.error('[assinaturas/get]', err);
    res.status(500).json({ error: 'Erro ao consultar assinatura.' });
  }
});

// === POST /api/assinaturas/trial === Cria empresa com 7 dias grátis (sem pagamento)
router.post('/trial', async (req, res) => {
  const { empresa, cnpj, telefone, nomeAdmin, emailAdmin, senhaAdmin } = req.body || {};
  if (!empresa || !empresa.trim()) return res.status(400).json({ error: 'Informe o nome da empresa.' });
  if (!nomeAdmin || !nomeAdmin.trim()) return res.status(400).json({ error: 'Informe o nome do administrador.' });
  if (!emailValido(emailAdmin)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (!senhaAdmin || senhaAdmin.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Verifica e-mail duplicado
    const dup = await client.query(
      'SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1) LIMIT 1',
      [emailAdmin.trim()]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Já existe um usuário com este e-mail. Use outro ou faça login.' });
    }
    // Verifica se já tem trial ativo com mesmo CNPJ (anti-abuso)
    if (cnpj && cnpj.trim()) {
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      if (cnpjLimpo) {
        const dupCnpj = await client.query(
          `SELECT id, status FROM empresas WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $1 LIMIT 1`,
          [cnpjLimpo]
        );
        if (dupCnpj.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Já existe uma empresa cadastrada com este CNPJ. Faça login ou contate o suporte.' });
        }
      }
    }
    // Cria empresa em status 'trial' com vencimento em 7 dias
    const dataVenc = new Date();
    dataVenc.setDate(dataVenc.getDate() + 7);
    const vencIso = dataVenc.toISOString().slice(0, 10);
    const empResult = await client.query(
      `INSERT INTO empresas (nome, cnpj, telefone, status, plano, data_vencimento, valor_mensalidade, origem)
       VALUES ($1, $2, $3, 'trial', 'trial', $4, 0, 'auto-assinatura') RETURNING *`,
      [empresa.trim(), cnpj || null, telefone || null, vencIso]
    );
    const novaEmpresa = empResult.rows[0];
    // Cria admin
    const senhaHash = await bcrypt.hash(senhaAdmin, 10);
    const userResult = await client.query(
      `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING id, email, nome, papel, empresa_id`,
      [novaEmpresa.id, emailAdmin.toLowerCase().trim(), nomeAdmin.trim(), senhaHash]
    );
    const novoUsuario = userResult.rows[0];
    await client.query('COMMIT');
    // Notifica admin do sistema (você) por e-mail
    try {
      const { enviarEmail } = require('../services/email');
      const dataFmt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jose.neto@glinformatica.com.br';
      enviarEmail({
        para: ADMIN_EMAIL,
        assunto: `🎁 Novo trial: ${empresa.trim()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e3a8a;">🎁 Novo trial cadastrado!</h2>
            <p>Uma empresa começou um teste de 7 dias.</p>
            <table style="width:100%; border-collapse: collapse;">
              <tr><td style="padding:6px 0;">Empresa:</td><td><strong>${empresa.trim()}</strong></td></tr>
              <tr><td style="padding:6px 0;">CNPJ:</td><td>${cnpj || '—'}</td></tr>
              <tr><td style="padding:6px 0;">Admin:</td><td>${nomeAdmin.trim()}</td></tr>
              <tr><td style="padding:6px 0;">E-mail:</td><td>${emailAdmin}</td></tr>
              <tr><td style="padding:6px 0;">Telefone:</td><td>${telefone || '—'}</td></tr>
              <tr><td style="padding:6px 0;">Trial expira em:</td><td>${vencIso.split('-').reverse().join('/')}</td></tr>
              <tr><td style="padding:6px 0;">Cadastrado em:</td><td>${dataFmt}</td></tr>
            </table>
          </div>`
      }).catch(e => console.error('[trial] erro ao enviar e-mail:', e.message));
    } catch (e) {
      console.error('[trial] erro ao notificar:', e.message);
    }
    // Gera token JWT já — login automático
    const token = gerarToken(novoUsuario);
    res.json({
      ok: true,
      token,
      usuario: { id: novoUsuario.id, nome: novoUsuario.nome, email: novoUsuario.email, papel: novoUsuario.papel },
      empresa: { id: novaEmpresa.id, nome: novaEmpresa.nome, status: 'trial', dataVencimento: vencIso },
      mensagem: 'Trial de 7 dias ativado!'
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[assinaturas/trial]', err);
    res.status(500).json({ error: 'Erro ao criar conta de teste. Tente novamente.' });
  } finally {
    client.release();
  }
});

// === POST /api/assinaturas/renovar === Cria checkout de renovação para empresa logada
// Body: { plano: 'mensal' | 'anual' }
// REQUER autenticação JWT do usuário admin
router.post('/renovar', async (req, res) => {
  // Verifica token JWT
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token de acesso necessário.' });
  let payload;
  try {
    const jwt = require('jsonwebtoken');
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
  if (payload.papel !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem renovar a assinatura.' });
  }

  const { plano } = req.body || {};
  if (!plano || !PLANOS[plano]) {
    return res.status(400).json({ error: 'Plano inválido. Use "basico", "pro" ou "pro-fiscal".' });
  }
  if (!pagbank.tokenConfigurado()) {
    return res.status(503).json({ error: 'Pagamento online temporariamente indisponível. Entre em contato pelo WhatsApp.' });
  }

  const planoConfig = PLANOS[plano];
  const referencia = gerarReferencia();

  try {
    // Busca dados da empresa e do usuário
    const r = await db.query(
      `SELECT u.email, u.nome AS nome_admin,
              e.nome AS empresa_nome, e.cnpj, e.telefone, e.plano AS plano_atual,
              e.data_vencimento, e.status
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = $1 LIMIT 1`,
      [payload.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const dados = r.rows[0];

    // Cria registro de assinatura (renovação)
    const assinResult = await db.query(
      `INSERT INTO assinaturas (empresa_id, referencia, plano, valor, status, email_contato)
       VALUES ($1, $2, $3, $4, 'pendente', $5) RETURNING *`,
      [payload.empresaId, referencia, plano, planoConfig.valor, dados.email]
    );
    const novaAssinatura = assinResult.rows[0];

    // Chama PagBank para criar checkout
    let checkout;
    try {
      checkout = await pagbank.criarCheckout({
        referencia,
        valor: planoConfig.valor,
        descricao: `Renovação — ${planoConfig.nome} — GL Sistema de Vendas`,
        email: dados.email,
        nome: dados.nome_admin,
        formas: ['CREDIT_CARD', 'BOLETO', 'PIX'],
        maxParcelas: plano === 'anual' ? 12 : 1
      });
    } catch (err) {
      // Marca assinatura como erro (não trava o sistema)
      await db.query(`UPDATE assinaturas SET status = 'erro' WHERE id = $1`, [novaAssinatura.id]);
      console.error('[assinaturas/renovar] Erro PagBank:', err.message, err.responseBody || '');
      return res.status(502).json({ error: 'Erro ao criar pagamento. Tente novamente em instantes.' });
    }

    // Atualiza assinatura com dados do checkout
    await db.query(
      `UPDATE assinaturas SET checkout_id = $1, link_pagamento = $2 WHERE id = $3`,
      [checkout.id, checkout.linkPagamento, novaAssinatura.id]
    );

    res.json({
      ok: true,
      referencia,
      linkPagamento: checkout.linkPagamento,
      plano,
      valor: planoConfig.valor
    });
  } catch (err) {
    console.error('[assinaturas/renovar]', err);
    res.status(500).json({ error: 'Erro ao processar renovação. Tente novamente.' });
  }
});

// === POST /api/assinaturas/webhook ===
// Recebe notificações do PagBank quando algo muda.
// O PagBank envia um POST com dados do pedido/checkout.
router.post('/webhook', async (req, res) => {
  // Sempre responde 200 rápido pro PagBank não tentar de novo
  // Processamos em background.
  res.json({ ok: true });

  try {
    const body = req.body || {};
    console.log('[webhook] recebido:', JSON.stringify(body).slice(0, 500));

    // O webhook do PagBank vem em vários formatos. Tentamos extrair:
    // - reference_id (nosso "referencia")
    // - charges[].status (PAID, AUTHORIZED, DECLINED, etc.)

    let referencia = body.reference_id;
    if (!referencia && body.id && String(body.id).startsWith('CHEC_')) {
      // Webhook de checkout — busca pelo checkout_id
      const r = await db.query('SELECT referencia FROM assinaturas WHERE checkout_id=$1', [body.id]);
      if (r.rows.length > 0) referencia = r.rows[0].referencia;
    }
    if (!referencia && body.id && String(body.id).startsWith('ORDE_')) {
      // Webhook de pedido — consulta no PagBank pra pegar reference_id
      try {
        const pedido = await pagbank.consultarPedido(body.id);
        referencia = pedido.reference_id;
        body.charges = pedido.charges; // hidrata charges para processar
      } catch(_) {}
    }

    if (!referencia) {
      console.warn('[webhook] sem reference_id identificável');
      return;
    }

    await processarPagamento(referencia, body);
  } catch (err) {
    console.error('[webhook] erro processando:', err);
  }
});

// Processa um pagamento recebido (chamado pelo webhook ou pelo polling do GET /:ref)
async function processarPagamento(referencia, dadosPedido) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const aRes = await client.query('SELECT * FROM assinaturas WHERE referencia=$1 FOR UPDATE', [referencia]);
    if (aRes.rows.length === 0) { await client.query('ROLLBACK'); return; }
    const assin = aRes.rows[0];
    if (assin.status === 'paga') { await client.query('ROLLBACK'); return; } // idempotente

    // Detecta status do pagamento
    const charges = dadosPedido.charges || [];
    const chargePaga = charges.find(c => c.status === 'PAID');
    const chargeRecusada = charges.find(c => c.status === 'DECLINED' || c.status === 'CANCELED');

    if (chargePaga) {
      // === CASO ESPECIAL: PAGAMENTO DE EMPRESA EXTRA (multi-empresa) ===
      if (assin.plano === 'empresa-extra') {
        const crypto = require('crypto');
        // Extrai metadata da assinatura (passamos o nome da nova empresa no ultimo_retorno inicial)
        let meta = {};
        try {
          if (assin.metadata) meta = typeof assin.metadata === 'string' ? JSON.parse(assin.metadata) : assin.metadata;
        } catch(_) {}
        const nomeNovaEmpresa = meta.nomeNovaEmpresa || 'Nova Empresa';
        const cnpjNovaEmpresa = meta.cnpjNovaEmpresa || null;

        // Busca o admin da empresa origem
        const adminQ = await client.query(
          `SELECT id, nome, email, senha_hash, grupo_id
           FROM usuarios
           WHERE empresa_id = $1 AND papel = 'admin'
           ORDER BY id ASC LIMIT 1`,
          [assin.empresa_id]
        );
        if (adminQ.rows.length === 0) {
          console.error('[webhook] empresa-extra: admin origem não encontrado');
          await client.query('UPDATE assinaturas SET status=$1, ultimo_retorno=$2 WHERE id=$3',
            ['erro', JSON.stringify({ erro: 'admin origem não encontrado', ...dadosPedido }), assin.id]);
          await client.query('COMMIT');
          return;
        }
        const adminOrigem = adminQ.rows[0];

        // Gera ou reaproveita grupo_id
        let grupoId = adminOrigem.grupo_id;
        if (!grupoId) {
          grupoId = 'grp_' + crypto.randomBytes(8).toString('hex');
          await client.query('UPDATE usuarios SET grupo_id = $1 WHERE id = $2',
            [grupoId, adminOrigem.id]);
        }

        // Cria nova empresa ATIVA (já paga) por 1 mês
        const novaVenc = new Date();
        novaVenc.setMonth(novaVenc.getMonth() + 1);
        const novaEmpresaQ = await client.query(
          `INSERT INTO empresas (nome, cnpj, status, plano, data_vencimento, valor_mensalidade, origem)
           VALUES ($1, $2, 'ativa', 'mensal', $3, 79.90, 'auto-assinatura-extra')
           RETURNING id, nome`,
          [nomeNovaEmpresa.trim(), cnpjNovaEmpresa, novaVenc.toISOString().slice(0,10)]
        );
        const novaEmpresa = novaEmpresaQ.rows[0];

        // Clona o admin na nova empresa
        await client.query(
          `INSERT INTO usuarios (empresa_id, email, nome, senha_hash, papel, grupo_id)
           VALUES ($1, $2, $3, $4, 'admin', $5)`,
          [novaEmpresa.id, adminOrigem.email, adminOrigem.nome, adminOrigem.senha_hash, grupoId]
        );

        // Marca a assinatura como paga
        const forma = chargePaga.payment_method?.type || dadosPedido.payment_method?.type || null;
        await client.query(
          `UPDATE assinaturas SET status='paga', forma_pagamento=$1, data_pagamento=NOW(),
             pedido_id=$2, ultimo_retorno=$3, atualizado_em=NOW() WHERE id=$4`,
          [forma, dadosPedido.id || null, JSON.stringify({ ...dadosPedido, novaEmpresaId: novaEmpresa.id }), assin.id]
        );

        // Registra pagamento da empresa extra (vincula à NOVA empresa pro histórico)
        await client.query(
          `INSERT INTO pagamentos (empresa_id, valor, data_pagamento, plano_aplicado,
                                   meses_adicionados, novo_vencimento, forma_pagamento, observacao)
           VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7)`,
          [novaEmpresa.id, assin.valor, 'mensal', 1, novaVenc.toISOString().slice(0,10),
           forma || 'PagBank', `Auto-assinatura empresa-extra ${referencia}`]
        );

        console.log(`[webhook] ✓ Empresa extra criada: ID ${novaEmpresa.id} (${novaEmpresa.nome}) no grupo ${grupoId}`);
        await client.query('COMMIT');
        return;
      }

      // === FLUXO NORMAL: ASSINATURA OU RENOVAÇÃO ===
      // Paga: ativa empresa
      const meses = assin.plano === 'anual' ? 12 : 1;
      // Pega vencimento atual da empresa (pode ser passado ou futuro)
      const rVenc = await client.query(
        `SELECT data_vencimento FROM empresas WHERE id = $1 LIMIT 1`,
        [assin.empresa_id]
      );
      const vencAtual = rVenc.rows[0]?.data_vencimento;
      const hoje = new Date();
      let baseRenovacao = hoje;
      // Se vencimento ATUAL é futuro, soma a partir dele (não perde dias do cliente)
      if (vencAtual) {
        const vencDate = new Date(vencAtual instanceof Date ? vencAtual : vencAtual + 'T00:00:00');
        if (vencDate > hoje) {
          baseRenovacao = vencDate;
        }
      }
      const novoVencimento = new Date(baseRenovacao);
      novoVencimento.setMonth(novoVencimento.getMonth() + meses);
      const vencIso = novoVencimento.toISOString().slice(0, 10);

      // Detecta forma de pagamento
      const forma = chargePaga.payment_method?.type || dadosPedido.payment_method?.type || null;

      await client.query(
        `UPDATE assinaturas SET status='paga', forma_pagamento=$1, data_pagamento=NOW(),
         pedido_id=$2, ultimo_retorno=$3, atualizado_em=NOW() WHERE id=$4`,
        [forma, dadosPedido.id || null, JSON.stringify(dadosPedido), assin.id]
      );

      // Ativa empresa
      // Se for plano Pro, também ativa o módulo fiscal
      const planoConfigAtivacao = PLANOS[assin.plano] || {};
      const ativaModuloFiscal = !!planoConfigAtivacao.moduloFiscal;
      if (ativaModuloFiscal) {
        await client.query(
          `UPDATE empresas SET
             status='ativa', plano=$1, data_vencimento=$2,
             modulo_fiscal_ativo=TRUE,
             modulo_fiscal_ativado_em=CASE WHEN modulo_fiscal_ativo=FALSE THEN NOW() ELSE modulo_fiscal_ativado_em END
           WHERE id=$3`,
          [assin.plano, vencIso, assin.empresa_id]
        );
      } else {
        await client.query(
          `UPDATE empresas SET status='ativa', plano=$1, data_vencimento=$2 WHERE id=$3`,
          [assin.plano, vencIso, assin.empresa_id]
        );
      }

      // Registra pagamento na tabela pagamentos (mesma usada pelo Master)
      await client.query(
        `INSERT INTO pagamentos (empresa_id, valor, data_pagamento, plano_aplicado,
                                 meses_adicionados, novo_vencimento, forma_pagamento, observacao)
         VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7)`,
        [assin.empresa_id, assin.valor, assin.plano, meses, vencIso,
         forma || 'PagBank', `Auto-assinatura ${referencia}`]
      );

      console.log(`[webhook] ✓ Assinatura ${referencia} paga, empresa ${assin.empresa_id} ativada até ${vencIso}`);

      // Notifica admin por e-mail (não bloqueia o webhook se falhar)
      try {
        const { notificarVendaParaAdmin } = require('../services/email');
        // Busca dados da empresa pra enriquecer o e-mail
        const rEmp = await client.query(
          `SELECT nome, cnpj, telefone FROM empresas WHERE id = $1`,
          [assin.empresa_id]
        );
        const emp = rEmp.rows[0] || {};
        // Não bloqueia o response — dispara em background
        notificarVendaParaAdmin({
          empresaNome: emp.nome,
          empresaCnpj: emp.cnpj,
          valorTotal: assin.valor,
          plano: assin.plano,
          emailCliente: assin.email_contato,
          telefoneCliente: emp.telefone,
          referenceId: referencia
        }).catch(e => console.error('[webhook] erro ao enviar e-mail:', e.message));
      } catch (e) {
        console.error('[webhook] erro ao montar e-mail:', e.message);
      }
    } else if (chargeRecusada) {
      await client.query(
        `UPDATE assinaturas SET status='recusada', ultimo_retorno=$1, atualizado_em=NOW() WHERE id=$2`,
        [JSON.stringify(dadosPedido), assin.id]
      );
      console.log(`[webhook] ✗ Assinatura ${referencia} recusada`);
    } else {
      // Outros status (in_analysis, etc.) — apenas atualiza retorno
      await client.query(
        `UPDATE assinaturas SET ultimo_retorno=$1, atualizado_em=NOW() WHERE id=$2`,
        [JSON.stringify(dadosPedido), assin.id]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[processarPagamento]', err);
  } finally {
    client.release();
  }
}

// === POST /api/assinaturas/renovar === (PRECISA estar autenticado)
// Body: { plano: 'mensal' | 'anual' }
// Cliente logado escolhe um plano para renovar — gera novo checkout PagBank
const { autenticar } = require('../middleware/auth');
router.post('/renovar', autenticar, async (req, res) => {
  const { plano } = req.body || {};
  if (!plano || !PLANOS[plano]) {
    return res.status(400).json({ error: 'Plano inválido. Use "basico", "pro" ou "pro-fiscal".' });
  }
  const planoConfig = PLANOS[plano];
  try {
    // Busca dados da empresa e usuário
    const r = await db.query(
      `SELECT e.id AS empresa_id, e.nome AS empresa_nome, e.cnpj, e.telefone,
              u.email, u.nome AS usuario_nome
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const dados = r.rows[0];
    // Cria assinatura
    const referencia = gerarReferencia();
    await db.query(
      `INSERT INTO assinaturas (empresa_id, referencia, plano, valor, status, email_contato)
       VALUES ($1, $2, $3, $4, 'pendente', $5)`,
      [dados.empresa_id, referencia, plano, planoConfig.valor, dados.email]
    );
    // Cria checkout no PagBank
    const checkout = await pagbank.criarCheckout({
      referencia,
      valor: planoConfig.valor,
      descricao: `${planoConfig.nome} — GL Sistema de Vendas (Renovação)`,
      email: dados.email,
      nome: dados.usuario_nome,
      formas: ['CREDIT_CARD', 'BOLETO', 'PIX'],
      maxParcelas: plano === 'anual' ? 12 : 1
    });
    if (!checkout || !checkout.linkPagamento) {
      return res.status(502).json({ error: 'Erro ao gerar link de pagamento. Tente novamente.' });
    }
    // Atualiza referência do PagBank
    if (checkout.checkoutId) {
      await db.query(
        `UPDATE assinaturas SET checkout_id = $1 WHERE referencia = $2`,
        [checkout.checkoutId, referencia]
      );
    }
    res.json({
      ok: true,
      referencia,
      linkPagamento: checkout.linkPagamento,
      plano: planoConfig.nome,
      valor: planoConfig.valor
    });
  } catch (err) {
    console.error('[assinaturas/renovar]', err);
    res.status(500).json({ error: 'Erro ao iniciar renovação. Tente novamente.' });
  }
});

// === POST /api/assinaturas/contratar-empresa-extra ===
// Body: { nomeNovaEmpresa, cnpjNovaEmpresa? }
// Cliente logado (admin) contrata uma empresa EXTRA por R$ 79,90/mês
// Gera checkout no PagBank → quando pagar, webhook cria a nova empresa + clona admin
router.post('/contratar-empresa-extra', autenticar, async (req, res) => {
  const { nomeNovaEmpresa, cnpjNovaEmpresa } = req.body || {};
  if (!nomeNovaEmpresa || nomeNovaEmpresa.trim().length < 2) {
    return res.status(400).json({ error: 'Informe o nome da nova empresa.' });
  }
  // Só admin pode contratar empresa extra
  if (req.user.papel !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem contratar empresas adicionais.' });
  }
  const planoConfig = PLANOS['empresa-extra'];
  try {
    // Busca dados da empresa origem e admin
    const r = await db.query(
      `SELECT e.id AS empresa_id, e.nome AS empresa_nome, e.cnpj, e.telefone,
              u.email, u.nome AS usuario_nome
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = $1 LIMIT 1`,
      [req.user.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const dados = r.rows[0];

    // Cria assinatura com plano empresa-extra (guarda nome da nova empresa em metadata)
    const referencia = gerarReferencia();
    const metadata = {
      nomeNovaEmpresa: nomeNovaEmpresa.trim(),
      cnpjNovaEmpresa: cnpjNovaEmpresa || null,
      empresaOrigemId: dados.empresa_id,
      empresaOrigemNome: dados.empresa_nome
    };
    await db.query(
      `INSERT INTO assinaturas (empresa_id, referencia, plano, valor, status, email_contato, metadata)
       VALUES ($1, $2, 'empresa-extra', $3, 'pendente', $4, $5)`,
      [dados.empresa_id, referencia, planoConfig.valor, dados.email, JSON.stringify(metadata)]
    );

    // Cria checkout no PagBank
    const checkout = await pagbank.criarCheckout({
      referencia,
      valor: planoConfig.valor,
      descricao: `Empresa Adicional: ${nomeNovaEmpresa.trim()} — GL Sistema de Vendas`,
      email: dados.email,
      nome: dados.usuario_nome,
      formas: ['CREDIT_CARD', 'BOLETO', 'PIX'],
      maxParcelas: 1
    });
    if (!checkout || !checkout.linkPagamento) {
      return res.status(502).json({ error: 'Erro ao gerar link de pagamento. Tente novamente.' });
    }
    if (checkout.checkoutId) {
      await db.query(
        `UPDATE assinaturas SET checkout_id = $1 WHERE referencia = $2`,
        [checkout.checkoutId, referencia]
      );
    }
    res.json({
      ok: true,
      referencia,
      linkPagamento: checkout.linkPagamento,
      valor: planoConfig.valor,
      nomeNovaEmpresa: nomeNovaEmpresa.trim()
    });
  } catch (err) {
    console.error('[assinaturas/contratar-empresa-extra]', err);
    res.status(500).json({ error: 'Erro ao contratar empresa extra. Tente novamente.' });
  }
});

module.exports = router;
