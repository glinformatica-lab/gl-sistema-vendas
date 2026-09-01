const express = require('express');
const db = require('../db');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};
const toNum = (v) => (v == null ? 0 : Number(v));

router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT e.*, uc.nome AS criado_por_nome
       FROM entradas e
       LEFT JOIN usuarios uc ON uc.id = e.criado_por
       WHERE e.empresa_id=$1 ORDER BY e.data DESC, e.id DESC`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(e => ({
      ...camelizar(e),
      itens: e.itens || [],
      totalGeral: toNum(e.total_geral), totalProdutos: toNum(e.total_produtos),
      frete: toNum(e.frete), seguro: toNum(e.seguro), outras: toNum(e.outras),
      desconto: toNum(e.desconto), totalNf: toNum(e.total_nf)
    })));
  } catch (err) {
    console.error('[entradas/list]', err);
    res.status(500).json({ error: 'Erro ao listar entradas.' });
  }
});

// GET /paginado — Lista paginada com filtros (versão otimizada)
router.get('/paginado', async (req, res) => {
  try {
    const { mes, fornecedor, busca } = req.query;
    let pagina = parseInt(req.query.pagina) || 1;
    let porPagina = parseInt(req.query.porPagina) || 50;
    if (pagina < 1) pagina = 1;
    if (porPagina < 1 || porPagina > 500) porPagina = 50;

    const where = ['empresa_id = $1'];
    const vals = [req.user.empresaId];
    let idx = 2;

    // Filtro mês (formato YYYY-MM)
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      where.push(`to_char(data, 'YYYY-MM') = $${idx++}`);
      vals.push(mes);
    }

    // Filtro fornecedor (nome exato)
    if (fornecedor && fornecedor.trim()) {
      where.push(`fornecedor = $${idx++}`);
      vals.push(fornecedor.trim());
    }

    // Busca: numero, doc, fornecedor (ILIKE)
    // Busca em itens (JSONB) exige textualização - CAST + ILIKE
    if (busca && busca.trim()) {
      const b = busca.trim();
      where.push(`(
        numero ILIKE $${idx} OR
        doc ILIKE $${idx} OR
        fornecedor ILIKE $${idx} OR
        itens::text ILIKE $${idx}
      )`);
      vals.push(`%${b}%`);
      idx++;
    }

    const whereSql = where.join(' AND ');

    // Count + soma agregada
    const rCount = await db.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(COALESCE(total_nf, total_geral, 0)), 0)::numeric AS soma_total
       FROM entradas WHERE ${whereSql}`,
      vals
    );
    const total = rCount.rows[0].total;
    const somaTotal = Number(rCount.rows[0].soma_total) || 0;

    // Lista paginada
    const offset = (pagina - 1) * porPagina;
    const rLista = await db.query(
      `SELECT e.*, uc.nome AS criado_por_nome
       FROM entradas e
       LEFT JOIN usuarios uc ON uc.id = e.criado_por
       WHERE ${whereSql.replace(/empresa_id/g, 'e.empresa_id')}
       ORDER BY e.data DESC, e.id DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, porPagina, offset]
    );

    res.json({
      entradas: rLista.rows.map(e => ({
        ...camelizar(e),
        itens: e.itens || [],
        totalGeral: toNum(e.total_geral), totalProdutos: toNum(e.total_produtos),
        frete: toNum(e.frete), seguro: toNum(e.seguro), outras: toNum(e.outras),
        desconto: toNum(e.desconto), totalNf: toNum(e.total_nf)
      })),
      total,
      somaTotal,
      pagina,
      porPagina,
      totalPaginas: Math.ceil(total / porPagina)
    });
  } catch (err) {
    console.error('[entradas/paginado]', err);
    res.status(500).json({ error: 'Erro ao listar entradas: ' + err.message });
  }
});

// GET /fornecedores-distintos — Lista de fornecedores únicos (pro select)
router.get('/fornecedores-distintos', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT DISTINCT fornecedor FROM entradas
       WHERE empresa_id=$1 AND fornecedor IS NOT NULL AND fornecedor <> ''
       ORDER BY fornecedor`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(row => row.fornecedor));
  } catch (err) {
    console.error('[entradas/fornecedores]', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// GET /resumo-mes — Contadores rápidos pro dashboard/cards
router.get('/resumo-mes', async (req, res) => {
  try {
    const mes = req.query.mes || new Date().toISOString().slice(0, 7);
    const r = await db.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(COALESCE(total_nf, total_geral, 0)), 0)::numeric AS soma_total
       FROM entradas
       WHERE empresa_id=$1 AND to_char(data, 'YYYY-MM')=$2`,
      [req.user.empresaId, mes]
    );
    res.json({
      mes,
      total: r.rows[0].total,
      somaTotal: Number(r.rows[0].soma_total) || 0
    });
  } catch (err) {
    console.error('[entradas/resumo]', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

router.post('/', async (req, res) => {
  const e = req.body || {};
  if (!e.fornecedor) return res.status(400).json({ error: 'Fornecedor é obrigatório.' });
  if (!e.tipo || !['sem-nf','com-nf'].includes(e.tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  if (!Array.isArray(e.itens) || e.itens.length === 0) return res.status(400).json({ error: 'Adicione ao menos um item.' });
  if (e.tipo === 'sem-nf' && !e.doc) return res.status(400).json({ error: 'Nº do documento é obrigatório.' });
  if (e.tipo === 'com-nf' && !e.numero) return res.status(400).json({ error: 'Nº da NF é obrigatório.' });

  for (const it of e.itens) {
    if (!it.produto || !it.qtd || it.qtd <= 0) return res.status(400).json({ error: 'Cada item precisa de produto e qtd > 0.' });
    if (!it.custo || it.custo <= 0) return res.status(400).json({ error: 'Custo unitário é obrigatório e deve ser > 0.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Valida produtos
    const nomes = [...new Set(e.itens.map(i => i.produto))];
    const prodResult = await client.query(
      'SELECT * FROM produtos WHERE empresa_id=$1 AND nome = ANY($2::text[])',
      [req.user.empresaId, nomes]
    );
    const produtosByNome = new Map(prodResult.rows.map(p => [p.nome, p]));
    for (const nome of nomes) {
      if (!produtosByNome.has(nome)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Produto "${nome}" não está cadastrado. Cadastre antes.` });
      }
    }

    // Calcula totais
    let totalProdutos = 0;
    for (const it of e.itens) totalProdutos += Number(it.qtd) * Number(it.custo);
    const totalNf = totalProdutos + (Number(e.frete) || 0) + (Number(e.seguro) || 0) + (Number(e.outras) || 0) - (Number(e.desconto) || 0);

    // Cria entrada
    const vencimento = (e.pagamento === 'A Prazo' || e.pagamento === 'Boleto') ? e.vencimento : null;
    if ((e.pagamento === 'A Prazo' || e.pagamento === 'Boleto') && !vencimento) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Informe a data prevista de pagamento.' });
    }

    const insEntrada = await client.query(
      `INSERT INTO entradas (empresa_id, tipo, data, fornecedor, doc, numero, serie, chave,
                             data_emissao, data_entrada, natureza, cnpj, itens,
                             total_geral, total_produtos, frete, seguro, outras, desconto, total_nf,
                             pagamento, vencimento, obs, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [req.user.empresaId, e.tipo,
       e.data || e.dataEntrada || new Date().toISOString().slice(0,10),
       e.fornecedor, e.doc || null, e.numero || null, e.serie || null, e.chave || null,
       e.dataEmissao || null, e.dataEntrada || null, e.natureza || null, e.cnpj || null,
       JSON.stringify(e.itens),
       e.tipo === 'sem-nf' ? totalProdutos : totalNf,
       totalProdutos, Number(e.frete) || 0, Number(e.seguro) || 0, Number(e.outras) || 0, Number(e.desconto) || 0, totalNf,
       e.pagamento, vencimento, e.obs || null, req.user.userId]
    );
    const entrada = insEntrada.rows[0];

    // Atualiza estoque, custo e venda + movimentações
    for (const it of e.itens) {
      const p = produtosByNome.get(it.produto);
      // Atualiza fornecedor SÓ se estiver vazio (null ou string vazia)
      await client.query(
        `UPDATE produtos SET estoque = estoque + $1, preco_custo = $2,
                preco_venda = COALESCE($3, preco_venda),
                fornecedor = CASE
                  WHEN fornecedor IS NULL OR TRIM(fornecedor) = '' THEN $6
                  ELSE fornecedor
                END
         WHERE id=$4 AND empresa_id=$5`,
        [Number(it.qtd), Number(it.custo),
         (it.precoVenda != null && it.precoVenda > 0) ? Number(it.precoVenda) : null,
         p.id, req.user.empresaId,
         e.fornecedor]
      );
      await client.query(
        `INSERT INTO movimentacoes (empresa_id, produto_codigo, produto_nome, data, tipo, qtd, origem, observacao, entrada_id)
         VALUES ($1,$2,$3,$4,'entrada',$5,$6,$7,$8)`,
        [req.user.empresaId, p.codigo, p.nome, e.data || e.dataEntrada || new Date().toISOString().slice(0,10),
         Number(it.qtd),
         e.tipo === 'sem-nf' ? `Entrada s/ NF — Doc ${e.doc}` : `NF ${e.numero}${e.serie ? '/'+e.serie : ''}`,
         `Custo unit.: R$ ${Number(it.custo).toFixed(2)}`,
         entrada.id]
      );
    }

    // Conta a pagar
    const dataEntrada = e.data || e.dataEntrada || new Date().toISOString().slice(0,10);
    const valorEntrada = e.tipo === 'sem-nf' ? totalProdutos : totalNf;
    const descricaoEntrada = e.tipo === 'sem-nf'
      ? `Entrada s/ NF — Doc ${e.doc}`
      : `NF ${e.numero}${e.serie ? '/'+e.serie : ''} - ${e.natureza || 'Compra'}`;
    if (vencimento) {
      // Pagamento a prazo / boleto
      await client.query(
        `INSERT INTO contas_pagar (empresa_id, fornecedor, descricao, valor, vencimento, status, entrada_id)
         VALUES ($1,$2,$3,$4,$5,'Pendente',$6)`,
        [req.user.empresaId, e.fornecedor, descricaoEntrada, valorEntrada, vencimento, entrada.id]
      );
    } else if (valorEntrada > 0) {
      // Pagamento à vista — registra como Paga na mesma data
      await client.query(
        `INSERT INTO contas_pagar (empresa_id, fornecedor, descricao, valor, vencimento, status, data_pagamento, entrada_id)
         VALUES ($1,$2,$3,$4,$5,'Paga',$5,$6)`,
        [req.user.empresaId, e.fornecedor, descricaoEntrada, valorEntrada, dataEntrada, entrada.id]
      );
    }

    // Fornecedor novo? cadastra
    const fExist = await client.query(
      'SELECT id FROM fornecedores WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2)',
      [req.user.empresaId, e.fornecedor]
    );
    if (fExist.rows.length === 0) {
      await client.query('INSERT INTO fornecedores (empresa_id, nome, doc) VALUES ($1,$2,$3)',
        [req.user.empresaId, e.fornecedor, e.cnpj || null]);
    }

    await client.query('COMMIT');
    res.json({
      ...camelizar(entrada),
      itens: entrada.itens,
      totalGeral: toNum(entrada.total_geral), totalProdutos: toNum(entrada.total_produtos),
      frete: toNum(entrada.frete), seguro: toNum(entrada.seguro), outras: toNum(entrada.outras),
      desconto: toNum(entrada.desconto), totalNf: toNum(entrada.total_nf)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[entradas/create]', err);
    res.status(500).json({ error: 'Erro ao registrar entrada.' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  // Só admin ou quem criou a entrada pode excluir
  if (req.user.papel !== 'admin') {
    const rDono = await db.query(
      'SELECT criado_por FROM entradas WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]
    );
    if (rDono.rows.length === 0) return res.status(404).json({ error: 'Entrada não encontrada.' });
    if (rDono.rows[0].criado_por && rDono.rows[0].criado_por !== req.user.userId) {
      return res.status(403).json({ error: 'Apenas administradores podem excluir entradas de outros usuários.' });
    }
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const movs = await client.query(
      "SELECT * FROM movimentacoes WHERE entrada_id=$1 AND empresa_id=$2 AND tipo='entrada'",
      [req.params.id, req.user.empresaId]
    );
    for (const m of movs.rows) {
      await client.query(
        'UPDATE produtos SET estoque = GREATEST(0, estoque - $1) WHERE empresa_id=$2 AND codigo=$3',
        [m.qtd, req.user.empresaId, m.produto_codigo]
      );
    }
    await client.query('DELETE FROM movimentacoes WHERE entrada_id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    await client.query(
      "DELETE FROM contas_pagar WHERE entrada_id=$1 AND empresa_id=$2",
      [req.params.id, req.user.empresaId]);
    const r = await client.query('DELETE FROM entradas WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [req.params.id, req.user.empresaId]);
    if (r.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Entrada não encontrada.' }); }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[entradas/delete]', err);
    res.status(500).json({ error: 'Erro ao excluir entrada.' });
  } finally {
    client.release();
  }
});

module.exports = router;
