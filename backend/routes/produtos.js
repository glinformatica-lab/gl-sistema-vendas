const express = require('express');
const db = require('../db');
const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = row[k];
  }
  return out;
};
const toNum = (v) => (v == null ? 0 : Number(v));

// Listar produtos da empresa
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM produtos WHERE empresa_id = $1 ORDER BY nome',
      [req.user.empresaId]
    );
    res.json(r.rows.map(p => ({
      ...camelizar(p),
      estoque: toNum(p.estoque),
      precoCusto: toNum(p.preco_custo),
      precoVenda: toNum(p.preco_venda)
    })));
  } catch (err) {
    console.error('[produtos/list]', err);
    res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
});

// Cadastrar produto
router.post('/', async (req, res) => {
  const { codigo, nome, categoria, fornecedor, estoque, precoCusto, precoVenda } = req.body || {};
  if (!nome || !fornecedor) return res.status(400).json({ error: 'Nome e fornecedor são obrigatórios.' });
  if (!precoCusto || precoCusto <= 0) return res.status(400).json({ error: 'Preço de custo deve ser maior que zero.' });
  if (!precoVenda || precoVenda <= 0) return res.status(400).json({ error: 'Preço de venda deve ser maior que zero.' });
  try {
    // Gera código automático se vazio (próximo após o maior numérico já existente)
    let codigoFinal = (codigo || '').trim();
    if (!codigoFinal) {
      const r = await db.query(
        'SELECT codigo FROM produtos WHERE empresa_id = $1',
        [req.user.empresaId]
      );
      let max = 1000;
      for (const row of r.rows) {
        if (row.codigo && /^\d+$/.test(row.codigo)) {
          const n = parseInt(row.codigo, 10);
          if (n > max) max = n;
        }
      }
      codigoFinal = String(max + 1);
    }
    const ins = await db.query(
      `INSERT INTO produtos (empresa_id, codigo, nome, categoria, fornecedor, estoque, preco_custo, preco_venda)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.empresaId, codigoFinal, nome.trim(), categoria || null, fornecedor.trim(),
       Number(estoque) || 0, Number(precoCusto), Number(precoVenda)]
    );
    const p = ins.rows[0];
    // Se tiver estoque inicial, registra movimentação
    if (Number(estoque) > 0) {
      await db.query(
        `INSERT INTO movimentacoes (empresa_id, produto_codigo, produto_nome, data, tipo, qtd, origem)
         VALUES ($1,$2,$3,CURRENT_DATE,'entrada',$4,'Estoque Inicial')`,
        [req.user.empresaId, p.codigo, p.nome, Number(estoque)]
      );
    }
    res.json({
      ...camelizar(p),
      estoque: toNum(p.estoque),
      precoCusto: toNum(p.preco_custo),
      precoVenda: toNum(p.preco_venda)
    });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Já existe um produto com esse nome.' });
    console.error('[produtos/create]', err);
    res.status(500).json({ error: 'Erro ao cadastrar produto.' });
  }
});

// Editar produto (não altera estoque diretamente — estoque vem por movimentações)
router.put('/:id', async (req, res) => {
  const { nome, categoria, fornecedor, precoCusto, precoVenda } = req.body || {};
  if (!nome || !fornecedor) return res.status(400).json({ error: 'Nome e fornecedor são obrigatórios.' });
  if (!precoCusto || precoCusto <= 0) return res.status(400).json({ error: 'Preço de custo deve ser maior que zero.' });
  if (!precoVenda || precoVenda <= 0) return res.status(400).json({ error: 'Preço de venda deve ser maior que zero.' });
  try {
    const r = await db.query(
      `UPDATE produtos SET nome=$1, categoria=$2, fornecedor=$3, preco_custo=$4, preco_venda=$5
       WHERE id=$6 AND empresa_id=$7 RETURNING *`,
      [nome.trim(), categoria || null, fornecedor.trim(), Number(precoCusto), Number(precoVenda),
       req.params.id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    const p = r.rows[0];
    res.json({
      ...camelizar(p),
      estoque: toNum(p.estoque),
      precoCusto: toNum(p.preco_custo),
      precoVenda: toNum(p.preco_venda)
    });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Já existe outro produto com esse nome.' });
    console.error('[produtos/update]', err);
    res.status(500).json({ error: 'Erro ao atualizar produto.' });
  }
});

// Importação em lote (planilha)
// Body: { itens: [{ codigo?, nome, categoria?, fornecedor, estoque?, precoCusto, precoVenda }, ...] }
// Resposta: { criados, atualizados, ignorados, erros: [{linha, motivo}] }
router.post('/importar', async (req, res) => {
  const { itens } = req.body || {};
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Nenhum produto recebido para importação.' });
  }
  if (itens.length > 1000) {
    return res.status(400).json({ error: 'Máximo de 1000 produtos por importação.' });
  }
  let criados = 0, atualizados = 0, ignorados = 0;
  const erros = [];
  // Próximo código auto (caso vazio)
  const r0 = await db.query('SELECT codigo FROM produtos WHERE empresa_id = $1', [req.user.empresaId]);
  let proximoCodigo = 1000;
  for (const row of r0.rows) {
    if (row.codigo && /^\d+$/.test(row.codigo)) {
      const n = parseInt(row.codigo, 10);
      if (n > proximoCodigo) proximoCodigo = n;
    }
  }
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i];
    const linha = i + 2; // assumindo cabeçalho na linha 1
    try {
      const nome = (it.nome || '').trim();
      const fornecedor = (it.fornecedor || '').trim();
      const precoCusto = Number(it.precoCusto);
      const precoVenda = Number(it.precoVenda);
      if (!nome) { erros.push({ linha, motivo: 'Nome em branco' }); ignorados++; continue; }
      if (!fornecedor) { erros.push({ linha, motivo: 'Fornecedor em branco' }); ignorados++; continue; }
      if (!precoCusto || precoCusto <= 0) { erros.push({ linha, motivo: 'Preço de custo inválido' }); ignorados++; continue; }
      if (!precoVenda || precoVenda <= 0) { erros.push({ linha, motivo: 'Preço de venda inválido' }); ignorados++; continue; }
      const estoque = Number(it.estoque) || 0;
      const categoria = (it.categoria || '').trim() || null;
      // Verifica se já existe produto com o mesmo nome (case-insensitive)
      const exist = await db.query(
        'SELECT id, codigo FROM produtos WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2) LIMIT 1',
        [req.user.empresaId, nome]
      );
      if (exist.rows.length > 0) {
        // Atualiza preços e categoria — NÃO mexe em estoque (estoque vem por movimentações)
        await db.query(
          `UPDATE produtos SET categoria=COALESCE($1, categoria), fornecedor=$2,
                 preco_custo=$3, preco_venda=$4
           WHERE id=$5 AND empresa_id=$6`,
          [categoria, fornecedor, precoCusto, precoVenda, exist.rows[0].id, req.user.empresaId]
        );
        atualizados++;
      } else {
        // Cria novo produto
        let codigoFinal = (it.codigo || '').toString().trim();
        if (!codigoFinal) {
          proximoCodigo++;
          codigoFinal = String(proximoCodigo);
        }
        // Verifica se código já existe pra essa empresa (gera outro se sim)
        const dupCod = await db.query(
          'SELECT id FROM produtos WHERE empresa_id=$1 AND codigo=$2 LIMIT 1',
          [req.user.empresaId, codigoFinal]
        );
        if (dupCod.rows.length > 0) {
          proximoCodigo++;
          codigoFinal = String(proximoCodigo);
        }
        const ins = await db.query(
          `INSERT INTO produtos (empresa_id, codigo, nome, categoria, fornecedor, estoque, preco_custo, preco_venda)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, codigo, nome`,
          [req.user.empresaId, codigoFinal, nome, categoria, fornecedor, estoque, precoCusto, precoVenda]
        );
        if (estoque > 0) {
          await db.query(
            `INSERT INTO movimentacoes (empresa_id, produto_codigo, produto_nome, data, tipo, qtd, origem)
             VALUES ($1,$2,$3,CURRENT_DATE,'entrada',$4,'Importação Planilha')`,
            [req.user.empresaId, ins.rows[0].codigo, ins.rows[0].nome, estoque]
          );
        }
        criados++;
      }
    } catch (e) {
      erros.push({ linha, motivo: e.message || 'Erro desconhecido' });
      ignorados++;
    }
  }
  res.json({ criados, atualizados, ignorados, total: itens.length, erros });
});

// Movimentações de um produto (histórico)
router.get('/:id/movimentacoes', async (req, res) => {
  try {
    const p = await db.query('SELECT codigo FROM produtos WHERE id=$1 AND empresa_id=$2',
      [req.params.id, req.user.empresaId]);
    if (p.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    const r = await db.query(
      `SELECT * FROM movimentacoes
       WHERE empresa_id=$1 AND produto_codigo=$2
       ORDER BY data DESC, id DESC`,
      [req.user.empresaId, p.rows[0].codigo]
    );
    res.json(r.rows.map(m => ({ ...camelizar(m), qtd: toNum(m.qtd) })));
  } catch (err) {
    console.error('[produtos/movimentacoes]', err);
    res.status(500).json({ error: 'Erro ao listar movimentações.' });
  }
});

module.exports = router;
