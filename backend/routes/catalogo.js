// routes/catalogo.js — catálogo público compartilhável (com curadoria)
const express = require('express');
const router = express.Router();
const db = require('../db');
const { autenticar } = require('../middleware/auth');

// ====== MIDDLEWARE: VERIFICAR PLANO ======
// Bloqueia acesso se o plano da empresa não estiver na lista de planos aceitos
async function verificarPlanoVendaOnline(req, res, next) {
  try {
    if (!req.user || !req.user.empresaId) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    const r = await db.query(
      `SELECT plano FROM empresas WHERE id = $1`,
      [req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const plano = r.rows[0].plano;
    // Planos COM acesso a Vendas Online: pro, pro-fiscal
    if (!['pro', 'pro-fiscal'].includes(plano)) {
      return res.status(403).json({
        error: 'Recurso disponível apenas no plano Pro ou superior.',
        upgradeRequired: true,
        planoAtual: plano
      });
    }
    next();
  } catch (err) {
    console.error('[verificarPlanoVendaOnline]', err);
    res.status(500).json({ error: 'Erro ao verificar plano.' });
  }
}

// ====== HELPERS ======
function gerarSlug(texto) {
  if (!texto) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function resolverSlugUnico(base, empresaIdAtual) {
  if (!base) base = 'empresa';
  let slug = base;
  let n = 1;
  while (true) {
    const r = await db.query(
      `SELECT id FROM empresas WHERE catalogo_slug = $1 AND id <> $2 LIMIT 1`,
      [slug, empresaIdAtual]
    );
    if (r.rows.length === 0) return slug;
    n++;
    slug = `${base}-${n}`;
    if (n > 1000) return base + '-' + Date.now();
  }
}

// ====== ROTAS ADMIN ======

// GET /api/catalogo/config — dados completos pra tela admin
router.get('/config', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  try {
    const emp = await db.query(
      `SELECT id, nome, cnpj, telefone, email, endereco, bairro, cidade, uf, cep, logo, catalogo_slug
       FROM empresas WHERE id = $1`,
      [req.user.empresaId]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const empresa = emp.rows[0];

    // Garante config padrão
    let cfg = await db.query(`SELECT * FROM catalogo_config WHERE empresa_id = $1`, [req.user.empresaId]);
    if (cfg.rows.length === 0) {
      await db.query(`INSERT INTO catalogo_config (empresa_id) VALUES ($1)`, [req.user.empresaId]);
      cfg = await db.query(`SELECT * FROM catalogo_config WHERE empresa_id = $1`, [req.user.empresaId]);
    }
    const c = cfg.rows[0];

    // Sugere slug se ainda não tem
    let slugSugerido = empresa.catalogo_slug;
    if (!slugSugerido) {
      const base = gerarSlug(empresa.nome);
      slugSugerido = await resolverSlugUnico(base, req.user.empresaId);
    }

    // Itens curados do catálogo
    const itens = await db.query(
      `SELECT ci.id, ci.produto_id, ci.ordem, ci.mostrar_preco, ci.mostrar_estoque, ci.descricao_custom,
              p.nome AS produto_nome, p.codigo, p.categoria, p.preco_venda, p.estoque, p.foto_url
       FROM catalogo_itens ci
       INNER JOIN produtos p ON p.id = ci.produto_id
       WHERE ci.empresa_id = $1
       ORDER BY ci.ordem ASC, p.nome ASC`,
      [req.user.empresaId]
    );

    res.json({
      empresa: {
        id: empresa.id, nome: empresa.nome, cnpj: empresa.cnpj, telefone: empresa.telefone,
        email: empresa.email, endereco: empresa.endereco, bairro: empresa.bairro,
        cidade: empresa.cidade, uf: empresa.uf, cep: empresa.cep, logoUrl: empresa.logo
      },
      slug: empresa.catalogo_slug,
      slugSugerido,
      config: {
        ativo: c.ativo,
        mensagemTopo: c.mensagem_topo,
        whatsapp: c.whatsapp
      },
      itens: itens.rows.map(i => ({
        id: i.id,
        produtoId: i.produto_id,
        produtoNome: i.produto_nome,
        codigo: i.codigo,
        categoria: i.categoria,
        precoVenda: i.preco_venda ? Number(i.preco_venda) : null,
        estoque: Number(i.estoque) || 0,
        fotoUrl: i.foto_url,
        ordem: i.ordem,
        mostrarPreco: i.mostrar_preco,
        mostrarEstoque: i.mostrar_estoque,
        descricaoCustom: i.descricao_custom
      }))
    });
  } catch (err) {
    console.error('[catalogo/config GET]', err);
    res.status(500).json({ error: 'Erro ao buscar configurações.' });
  }
});

// PUT /api/catalogo/config — atualiza config geral + slug
router.put('/config', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  const { slug, ativo, mensagemTopo, whatsapp } = req.body || {};

  if (slug != null) {
    if (typeof slug !== 'string' || !/^[a-z0-9-]{2,60}$/.test(slug)) {
      return res.status(400).json({ error: 'Slug inválido. Use apenas letras minúsculas, números e hífens (2-60 caracteres).' });
    }
  }
  if (whatsapp && String(whatsapp).length > 30) {
    return res.status(400).json({ error: 'WhatsApp muito longo.' });
  }
  if (mensagemTopo && String(mensagemTopo).length > 500) {
    return res.status(400).json({ error: 'Mensagem muito longa (máx 500).' });
  }

  try {
    if (slug != null) {
      const exists = await db.query(
        `SELECT id FROM empresas WHERE catalogo_slug = $1 AND id <> $2 LIMIT 1`,
        [slug, req.user.empresaId]
      );
      if (exists.rows.length > 0) {
        return res.status(409).json({ error: 'Esse link já está em uso. Escolha outro.' });
      }
      await db.query(`UPDATE empresas SET catalogo_slug = $1 WHERE id = $2`, [slug, req.user.empresaId]);
    }

    await db.query(`INSERT INTO catalogo_config (empresa_id) VALUES ($1) ON CONFLICT DO NOTHING`, [req.user.empresaId]);
    await db.query(
      `UPDATE catalogo_config SET
         ativo = COALESCE($1, ativo),
         mensagem_topo = $2,
         whatsapp = $3,
         atualizado_em = NOW()
       WHERE empresa_id = $4`,
      [
        typeof ativo === 'boolean' ? ativo : null,
        mensagemTopo || null,
        whatsapp || null,
        req.user.empresaId
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[catalogo/config PUT]', err);
    res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
});

// POST /api/catalogo/itens — adiciona produtos ao catálogo (recebe array de produto_ids)
router.post('/itens', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  const { produtoIds } = req.body || {};
  if (!Array.isArray(produtoIds) || produtoIds.length === 0) {
    return res.status(400).json({ error: 'Informe pelo menos um produto.' });
  }
  try {
    // Pega o maior ordem atual
    const ordR = await db.query(
      `SELECT COALESCE(MAX(ordem), 0) AS max FROM catalogo_itens WHERE empresa_id = $1`,
      [req.user.empresaId]
    );
    let ordem = parseInt(ordR.rows[0].max) || 0;

    // Insere cada produto (ignora se já está no catálogo)
    let inseridos = 0;
    for (const pid of produtoIds) {
      const pidNum = parseInt(pid);
      if (!pidNum) continue;
      ordem++;
      const r = await db.query(
        `INSERT INTO catalogo_itens (empresa_id, produto_id, ordem)
         VALUES ($1, $2, $3) ON CONFLICT (empresa_id, produto_id) DO NOTHING`,
        [req.user.empresaId, pidNum, ordem]
      );
      if (r.rowCount > 0) inseridos++;
    }
    res.json({ ok: true, inseridos });
  } catch (err) {
    console.error('[catalogo/itens POST]', err);
    res.status(500).json({ error: 'Erro ao adicionar produtos.' });
  }
});

// PUT /api/catalogo/itens/:id — edita um item (toggle preço, estoque, descrição)
router.put('/itens/:id', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  const { mostrarPreco, mostrarEstoque, descricaoCustom } = req.body || {};
  try {
    const r = await db.query(
      `UPDATE catalogo_itens SET
         mostrar_preco = COALESCE($1, mostrar_preco),
         mostrar_estoque = COALESCE($2, mostrar_estoque),
         descricao_custom = $3
       WHERE id = $4 AND empresa_id = $5
       RETURNING id`,
      [
        typeof mostrarPreco === 'boolean' ? mostrarPreco : null,
        typeof mostrarEstoque === 'boolean' ? mostrarEstoque : null,
        descricaoCustom || null,
        req.params.id,
        req.user.empresaId
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[catalogo/itens PUT]', err);
    res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
});

// DELETE /api/catalogo/itens/:id — remove um produto do catálogo
router.delete('/itens/:id', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  try {
    await db.query(
      `DELETE FROM catalogo_itens WHERE id = $1 AND empresa_id = $2`,
      [req.params.id, req.user.empresaId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[catalogo/itens DELETE]', err);
    res.status(500).json({ error: 'Erro ao remover item.' });
  }
});

// PUT /api/catalogo/itens/ordem — reordena itens (recebe array de IDs na nova ordem)
router.put('/ordem', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  const { ordem } = req.body || {};
  if (!Array.isArray(ordem) || ordem.length === 0) {
    return res.status(400).json({ error: 'Informe a nova ordem.' });
  }
  try {
    // Atualiza ordem de cada item (em uma única transação)
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ordem.length; i++) {
        const id = parseInt(ordem[i]);
        if (!id) continue;
        await client.query(
          `UPDATE catalogo_itens SET ordem = $1 WHERE id = $2 AND empresa_id = $3`,
          [i + 1, id, req.user.empresaId]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[catalogo/ordem]', err);
    res.status(500).json({ error: 'Erro ao reordenar.' });
  }
});

// ====== ROTA PÚBLICA ======

// GET /api/catalogo/publico/:slug
router.get('/publico/:slug', async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase().trim();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
    return res.status(400).json({ error: 'Link inválido.' });
  }
  try {
    const emp = await db.query(
      `SELECT e.id, e.nome, e.cnpj, e.telefone, e.email, e.endereco, e.bairro, e.cidade, e.uf, e.cep, e.logo, e.plano, e.status
       FROM empresas e WHERE e.catalogo_slug = $1 LIMIT 1`,
      [slug]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Catálogo não encontrado.' });
    const empresa = emp.rows[0];

    // Bloqueia se empresa não está no plano Pro ou Pro Fiscal
    if (!['pro', 'pro-fiscal'].includes(empresa.plano)) {
      return res.status(404).json({ error: 'Esse catálogo não está disponível no momento.' });
    }

    // Bloqueia se empresa está suspensa/cancelada
    if (empresa.status && !['ativa', 'trial'].includes(empresa.status)) {
      return res.status(404).json({ error: 'Esse catálogo não está disponível no momento.' });
    }

    const cfg = await db.query(`SELECT * FROM catalogo_config WHERE empresa_id = $1`, [empresa.id]);
    if (cfg.rows.length === 0 || !cfg.rows[0].ativo) {
      return res.status(404).json({ error: 'Esse catálogo não está disponível no momento.' });
    }
    const c = cfg.rows[0];

    // Itens curados
    const itens = await db.query(
      `SELECT ci.id, ci.ordem, ci.mostrar_preco, ci.mostrar_estoque, ci.descricao_custom,
              p.nome, p.codigo, p.categoria, p.preco_venda, p.estoque, p.foto_url
       FROM catalogo_itens ci
       INNER JOIN produtos p ON p.id = ci.produto_id
       WHERE ci.empresa_id = $1
       ORDER BY ci.ordem ASC`,
      [empresa.id]
    );

    const categorias = [...new Set(itens.rows.map(i => i.categoria).filter(Boolean))].sort();

    const produtos = itens.rows.map(i => ({
      id: i.id,
      nome: i.nome,
      codigo: i.codigo,
      categoria: i.categoria,
      precoVenda: i.mostrar_preco && i.preco_venda ? Number(i.preco_venda) : null,
      mostrarPreco: i.mostrar_preco,
      mostrarEstoque: i.mostrar_estoque,
      estoque: i.mostrar_estoque ? (Number(i.estoque) || 0) : null,
      disponivel: (Number(i.estoque) || 0) > 0,
      fotoUrl: i.foto_url || null,
      descricao: i.descricao_custom || null
    }));

    res.json({
      empresa: {
        nome: empresa.nome, cnpj: empresa.cnpj, telefone: empresa.telefone,
        email: empresa.email, endereco: empresa.endereco, bairro: empresa.bairro,
        cidade: empresa.cidade, uf: empresa.uf, cep: empresa.cep, logoUrl: empresa.logo
      },
      config: { mensagemTopo: c.mensagem_topo, whatsapp: c.whatsapp },
      categorias,
      produtos
    });
  } catch (err) {
    console.error('[catalogo/publico]', err);
    res.status(500).json({ error: 'Erro ao carregar catálogo.' });
  }
});

// ====== ROTAS DE PEDIDOS ONLINE ======

// Helper: gera número amigável do pedido (PED-2026-0001)
async function gerarNumeroPedido(empresaId) {
  const ano = new Date().getFullYear();
  const r = await db.query(
    `SELECT COUNT(*) AS qtd FROM pedidos_online
     WHERE empresa_id = $1 AND EXTRACT(YEAR FROM criado_em) = $2`,
    [empresaId, ano]
  );
  const seq = parseInt(r.rows[0].qtd) + 1;
  return `PED-${ano}-${String(seq).padStart(4, '0')}`;
}

// POST /api/catalogo/publico/:slug/pedidos — cliente final cria pedido
router.post('/publico/:slug/pedidos', async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase().trim();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
    return res.status(400).json({ error: 'Link inválido.' });
  }
  const {
    clienteNome, clienteTelefone, clienteEmail, clienteDocumento,
    endereco, bairro, cidade, uf, cep, complemento,
    observacoes, itens
  } = req.body || {};

  // Validações básicas
  if (!clienteNome || String(clienteNome).trim().length < 2) {
    return res.status(400).json({ error: 'Informe o nome do cliente.' });
  }
  if (!clienteTelefone || String(clienteTelefone).replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Informe um telefone válido (com DDD).' });
  }
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Adicione pelo menos 1 produto ao pedido.' });
  }
  if (itens.length > 200) {
    return res.status(400).json({ error: 'Pedido com muitos itens. Limite: 200.' });
  }

  try {
    // 1) Resolve empresa pelo slug
    const emp = await db.query(
      `SELECT id, nome, plano, status FROM empresas WHERE catalogo_slug = $1 LIMIT 1`,
      [slug]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Catálogo não encontrado.' });
    const empresa = emp.rows[0];

    // Bloqueia se plano não tem Vendas Online
    if (!['pro', 'pro-fiscal'].includes(empresa.plano)) {
      return res.status(403).json({ error: 'Esse catálogo não aceita pedidos no momento.' });
    }
    // Bloqueia se empresa suspensa
    if (empresa.status && !['ativa', 'trial'].includes(empresa.status)) {
      return res.status(403).json({ error: 'Esse catálogo não aceita pedidos no momento.' });
    }

    // 2) Verifica se catálogo está ativo
    const cfg = await db.query(`SELECT ativo FROM catalogo_config WHERE empresa_id = $1`, [empresa.id]);
    if (cfg.rows.length === 0 || !cfg.rows[0].ativo) {
      return res.status(403).json({ error: 'Esse catálogo não aceita pedidos no momento.' });
    }

    // 3) Valida e processa os itens (busca dados oficiais do banco)
    const itensProcessados = [];
    let subtotal = 0;
    for (const it of itens) {
      const itemId = parseInt(it.itemId); // ID em catalogo_itens
      const qtd = Number(it.qtd) || 0;
      if (!itemId || qtd <= 0 || qtd > 9999) continue;

      // Busca produto pelo item do catálogo (garantindo que pertence à empresa)
      const r = await db.query(
        `SELECT ci.mostrar_preco, p.id AS produto_id, p.nome, p.codigo, p.preco_venda
         FROM catalogo_itens ci
         INNER JOIN produtos p ON p.id = ci.produto_id
         WHERE ci.id = $1 AND ci.empresa_id = $2 LIMIT 1`,
        [itemId, empresa.id]
      );
      if (r.rows.length === 0) continue;
      const p = r.rows[0];
      const precoUnit = (p.mostrar_preco && p.preco_venda) ? Number(p.preco_venda) : null;
      const sub = precoUnit ? precoUnit * qtd : 0;
      subtotal += sub;
      itensProcessados.push({
        produtoId: p.produto_id,
        produtoNome: p.nome,
        produtoCodigo: p.codigo,
        quantidade: qtd,
        precoUnitario: precoUnit,
        subtotal: sub
      });
    }
    if (itensProcessados.length === 0) {
      return res.status(400).json({ error: 'Nenhum item válido no pedido.' });
    }

    // 4) Cria o pedido + itens (em transação)
    const numero = await gerarNumeroPedido(empresa.id);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const novoPedido = await client.query(
        `INSERT INTO pedidos_online
          (empresa_id, numero, cliente_nome, cliente_telefone, cliente_email, cliente_documento,
           endereco, bairro, cidade, uf, cep, complemento,
           subtotal, total, observacoes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'novo')
         RETURNING id, numero, criado_em`,
        [
          empresa.id, numero,
          String(clienteNome).trim().slice(0, 200),
          String(clienteTelefone).trim().slice(0, 30),
          clienteEmail ? String(clienteEmail).trim().slice(0, 200) : null,
          clienteDocumento ? String(clienteDocumento).trim().slice(0, 30) : null,
          endereco ? String(endereco).trim().slice(0, 300) : null,
          bairro ? String(bairro).trim().slice(0, 100) : null,
          cidade ? String(cidade).trim().slice(0, 100) : null,
          uf ? String(uf).trim().slice(0, 2).toUpperCase() : null,
          cep ? String(cep).replace(/\D/g, '').slice(0, 8) : null,
          complemento ? String(complemento).trim().slice(0, 200) : null,
          subtotal, subtotal,
          observacoes ? String(observacoes).trim().slice(0, 1000) : null
        ]
      );
      const pedidoId = novoPedido.rows[0].id;
      for (const it of itensProcessados) {
        await client.query(
          `INSERT INTO pedidos_online_itens
            (pedido_id, produto_id, produto_nome, produto_codigo, quantidade, preco_unitario, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [pedidoId, it.produtoId, it.produtoNome, it.produtoCodigo, it.quantidade, it.precoUnitario, it.subtotal]
        );
      }
      await client.query('COMMIT');
      res.json({
        ok: true,
        pedido: {
          id: pedidoId,
          numero,
          total: subtotal,
          empresaNome: empresa.nome
        }
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[catalogo/pedidos POST]', err);
    res.status(500).json({ error: 'Erro ao registrar pedido. Tente novamente.' });
  }
});

// GET /api/catalogo/pedidos — admin lista pedidos da empresa
router.get('/pedidos', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  const { status, limit } = req.query;
  const lim = Math.min(parseInt(limit) || 100, 500);
  const where = ['empresa_id = $1'];
  const params = [req.user.empresaId];
  if (status) {
    where.push('status = $2');
    params.push(status);
  }
  try {
    const r = await db.query(
      `SELECT id, numero, cliente_nome, cliente_telefone, cliente_email,
              endereco, bairro, cidade, uf, cep, complemento,
              subtotal, total, status, observacoes, venda_id, criado_em
       FROM pedidos_online
       WHERE ${where.join(' AND ')}
       ORDER BY criado_em DESC
       LIMIT ${lim}`,
      params
    );
    // Conta itens de cada pedido
    const ids = r.rows.map(p => p.id);
    let contadores = {};
    if (ids.length > 0) {
      const cont = await db.query(
        `SELECT pedido_id, COUNT(*) AS qtd FROM pedidos_online_itens
         WHERE pedido_id = ANY($1) GROUP BY pedido_id`,
        [ids]
      );
      cont.rows.forEach(c => { contadores[c.pedido_id] = parseInt(c.qtd); });
    }
    res.json({
      pedidos: r.rows.map(p => ({
        id: p.id,
        numero: p.numero,
        clienteNome: p.cliente_nome,
        clienteTelefone: p.cliente_telefone,
        clienteEmail: p.cliente_email,
        endereco: p.endereco,
        bairro: p.bairro,
        cidade: p.cidade,
        uf: p.uf,
        cep: p.cep,
        complemento: p.complemento,
        subtotal: Number(p.subtotal),
        total: Number(p.total),
        status: p.status,
        observacoes: p.observacoes,
        vendaId: p.venda_id,
        qtdItens: contadores[p.id] || 0,
        criadoEm: p.criado_em
      }))
    });
  } catch (err) {
    console.error('[catalogo/pedidos GET]', err);
    res.status(500).json({ error: 'Erro ao listar pedidos.' });
  }
});

// GET /api/catalogo/pedidos/:id — admin vê detalhes de um pedido
router.get('/pedidos/:id', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  try {
    const p = await db.query(
      `SELECT * FROM pedidos_online WHERE id = $1 AND empresa_id = $2 LIMIT 1`,
      [req.params.id, req.user.empresaId]
    );
    if (p.rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
    const itens = await db.query(
      `SELECT id, produto_id, produto_nome, produto_codigo, quantidade, preco_unitario, subtotal
       FROM pedidos_online_itens WHERE pedido_id = $1`,
      [req.params.id]
    );
    const pedido = p.rows[0];
    res.json({
      pedido: {
        id: pedido.id,
        numero: pedido.numero,
        clienteNome: pedido.cliente_nome,
        clienteTelefone: pedido.cliente_telefone,
        clienteEmail: pedido.cliente_email,
        clienteDocumento: pedido.cliente_documento,
        endereco: pedido.endereco,
        bairro: pedido.bairro,
        cidade: pedido.cidade,
        uf: pedido.uf,
        cep: pedido.cep,
        complemento: pedido.complemento,
        subtotal: Number(pedido.subtotal),
        total: Number(pedido.total),
        status: pedido.status,
        observacoes: pedido.observacoes,
        vendaId: pedido.venda_id,
        criadoEm: pedido.criado_em,
        atualizadoEm: pedido.atualizado_em
      },
      itens: itens.rows.map(i => ({
        id: i.id,
        produtoId: i.produto_id,
        nome: i.produto_nome,
        codigo: i.produto_codigo,
        quantidade: Number(i.quantidade),
        precoUnitario: i.preco_unitario ? Number(i.preco_unitario) : null,
        subtotal: i.subtotal ? Number(i.subtotal) : 0
      }))
    });
  } catch (err) {
    console.error('[catalogo/pedidos GET id]', err);
    res.status(500).json({ error: 'Erro ao buscar pedido.' });
  }
});

// PUT /api/catalogo/pedidos/:id/status — admin muda status
router.put('/pedidos/:id/status', autenticar, verificarPlanoVendaOnline, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  const { status } = req.body || {};
  if (!['novo', 'em-atendimento', 'confirmado', 'cancelado', 'convertido-em-venda'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  try {
    const r = await db.query(
      `UPDATE pedidos_online SET status = $1, atualizado_em = NOW()
       WHERE id = $2 AND empresa_id = $3 RETURNING id`,
      [status, req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[catalogo/pedidos status]', err);
    res.status(500).json({ error: 'Erro ao atualizar status.' });
  }
});

module.exports = router;
