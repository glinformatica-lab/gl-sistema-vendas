// routes/catalogo.js — catálogo público compartilhável (com curadoria)
const express = require('express');
const router = express.Router();
const db = require('../db');
const { autenticar } = require('../middleware/auth');

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
router.get('/config', autenticar, async (req, res) => {
  if (req.user.papel !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  try {
    const emp = await db.query(
      `SELECT id, nome, cnpj, telefone, email, endereco, bairro, cidade, uf, cep, logo_url, catalogo_slug
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
        cidade: empresa.cidade, uf: empresa.uf, cep: empresa.cep, logoUrl: empresa.logo_url
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
router.put('/config', autenticar, async (req, res) => {
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
router.post('/itens', autenticar, async (req, res) => {
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
router.put('/itens/:id', autenticar, async (req, res) => {
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
router.delete('/itens/:id', autenticar, async (req, res) => {
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
router.put('/ordem', autenticar, async (req, res) => {
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
      `SELECT e.id, e.nome, e.cnpj, e.telefone, e.email, e.endereco, e.bairro, e.cidade, e.uf, e.cep, e.logo_url
       FROM empresas e WHERE e.catalogo_slug = $1 LIMIT 1`,
      [slug]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Catálogo não encontrado.' });
    const empresa = emp.rows[0];

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
        cidade: empresa.cidade, uf: empresa.uf, cep: empresa.cep, logoUrl: empresa.logo_url
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

module.exports = router;
