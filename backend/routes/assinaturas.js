// Rotas públicas (SEM auth) para o fluxo de auto-assinatura.
// - POST /api/assinaturas/iniciar  — cria empresa + assinatura + checkout no PagBank
// - GET  /api/assinaturas/:ref     — consulta status de uma assinatura pela referência
// - POST /api/assinaturas/webhook  — recebe notificações do PagBank
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const pagbank = require('../services/pagbank');

const router = express.Router();

// Configuração dos planos disponíveis
const PLANOS = {
  mensal: { nome: 'Plano Mensal', valor: 99.90, meses: 1 },
  anual:  { nome: 'Plano Anual',  valor: 1080.00, meses: 12 }
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
    return res.status(400).json({ error: 'Plano inválido. Use "mensal" ou "anual".' });
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
    const empResult = await client.query(
      `INSERT INTO empresas (nome, cnpj, telefone, status, plano, valor_mensalidade, origem)
       VALUES ($1, $2, $3, 'aguardando-pagamento', $4, $5, 'auto-assinatura') RETURNING *`,
      [empresa.trim(), cnpj || null, telefone || null, plano,
       plano === 'mensal' ? planoConfig.valor : (planoConfig.valor / 12)]
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
      // Paga: ativa empresa
      const meses = assin.plano === 'anual' ? 12 : 1;
      const novoVencimento = new Date();
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
      await client.query(
        `UPDATE empresas SET status='ativa', plano=$1, data_vencimento=$2 WHERE id=$3`,
        [assin.plano, vencIso, assin.empresa_id]
      );

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

module.exports = router;
