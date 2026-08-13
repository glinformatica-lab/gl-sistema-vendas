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
  const {
    codigo, nome, categoria, fornecedor, estoque, precoCusto, precoVenda,
    ncm, cest, cfopPadrao, origemMercadoria, csosn, cst, unidadeTributavel,
    fotoUrl, descricaoImpressao, observacaoInterna, referencia,
    marca, marcaId
  } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  if (!precoCusto || precoCusto <= 0) return res.status(400).json({ error: 'Preço de custo deve ser maior que zero.' });
  if (!precoVenda || precoVenda <= 0) return res.status(400).json({ error: 'Preço de venda deve ser maior que zero.' });
  // Valida NCM se foi enviado (8 dígitos)
  if (ncm && !/^\d{8}$/.test(String(ncm).replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'NCM deve ter 8 dígitos numéricos.' });
  }
  // Valida URL da foto (precisa ser https do Cloudinary, evita injeção de URLs maliciosas)
  if (fotoUrl && !/^https:\/\/res\.cloudinary\.com\//.test(fotoUrl)) {
    return res.status(400).json({ error: 'URL de foto inválida.' });
  }
  try {
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
    // Resolve marca: se veio marcaId, valida e pega o nome. Senão usa o texto de "marca"
    let marcaFinalNome = null;
    let marcaFinalId = null;
    if (marcaId) {
      const rMarca = await db.query(
        'SELECT id, nome FROM marcas WHERE id=$1 AND empresa_id=$2',
        [marcaId, req.user.empresaId]
      );
      if (rMarca.rows.length > 0) {
        marcaFinalId = rMarca.rows[0].id;
        marcaFinalNome = rMarca.rows[0].nome;
      }
    }
    if (!marcaFinalNome && marca) {
      marcaFinalNome = String(marca).trim() || null;
    }

    const ins = await db.query(
      `INSERT INTO produtos (
         empresa_id, codigo, nome, categoria, fornecedor, estoque, preco_custo, preco_venda,
         ncm, cest, cfop_padrao, origem_mercadoria, csosn, cst, unidade_tributavel, foto_url,
         descricao_impressao, observacao_interna, referencia, marca, marca_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [req.user.empresaId, codigoFinal, nome.trim(), categoria || null, (fornecedor ? fornecedor.trim() : null),
       Number(estoque) || 0, Number(precoCusto), Number(precoVenda),
       ncm ? String(ncm).replace(/\D/g, '') : null,
       cest ? String(cest).replace(/\D/g, '') : null,
       cfopPadrao || null,
       origemMercadoria || null,
       csosn || null,
       cst || null,
       unidadeTributavel || null,
       fotoUrl || null,
       descricaoImpressao ? String(descricaoImpressao).trim() : null,
       observacaoInterna ? String(observacaoInterna).trim() : null,
       referencia ? String(referencia).trim().toUpperCase() : null,
       marcaFinalNome,
       marcaFinalId]
    );
    const p = ins.rows[0];

    // Auto-gera código de barras baseado no ID (só empresas com módulo iluminação)
    const empChk = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
    const usaAmbientes = empChk.rows[0]?.usa_ambientes;
    if (usaAmbientes && !p.codigo_barras) {
      const codigoBarras = 'PRD-' + String(p.id).padStart(6, '0');
      const upd = await db.query(
        'UPDATE produtos SET codigo_barras=$1 WHERE id=$2 RETURNING *',
        [codigoBarras, p.id]
      );
      Object.assign(p, upd.rows[0]);
    }

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
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('referencia')) {
        return res.status(400).json({ error: 'Já existe um produto com essa referência.' });
      }
      return res.status(400).json({ error: 'Já existe um produto com esse nome.' });
    }
    console.error('[produtos/create]', err);
    res.status(500).json({ error: 'Erro ao cadastrar produto.' });
  }
});

// Editar produto (não altera estoque diretamente — estoque vem por movimentações)
router.put('/:id', async (req, res) => {
  const {
    nome, categoria, fornecedor, precoCusto, precoVenda,
    ncm, cest, cfopPadrao, origemMercadoria, csosn, cst, unidadeTributavel,
    fotoUrl, descricaoImpressao, observacaoInterna, referencia,
    marca, marcaId
  } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  if (!precoCusto || precoCusto <= 0) return res.status(400).json({ error: 'Preço de custo deve ser maior que zero.' });
  if (!precoVenda || precoVenda <= 0) return res.status(400).json({ error: 'Preço de venda deve ser maior que zero.' });
  if (ncm && !/^\d{8}$/.test(String(ncm).replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'NCM deve ter 8 dígitos numéricos.' });
  }
  // Valida URL da foto (precisa ser https do Cloudinary)
  if (fotoUrl && !/^https:\/\/res\.cloudinary\.com\//.test(fotoUrl)) {
    return res.status(400).json({ error: 'URL de foto inválida.' });
  }
  try {
    // Resolve marca (mesma lógica do POST)
    let marcaFinalNome = null;
    let marcaFinalId = null;
    if (marcaId) {
      const rMarca = await db.query(
        'SELECT id, nome FROM marcas WHERE id=$1 AND empresa_id=$2',
        [marcaId, req.user.empresaId]
      );
      if (rMarca.rows.length > 0) {
        marcaFinalId = rMarca.rows[0].id;
        marcaFinalNome = rMarca.rows[0].nome;
      }
    }
    if (!marcaFinalNome && marca) {
      marcaFinalNome = String(marca).trim() || null;
    }

    const r = await db.query(
      `UPDATE produtos SET
         nome=$1, categoria=$2, fornecedor=$3, preco_custo=$4, preco_venda=$5,
         ncm=$6, cest=$7, cfop_padrao=$8, origem_mercadoria=$9,
         csosn=$10, cst=$11, unidade_tributavel=$12, foto_url=$13,
         descricao_impressao=$14, observacao_interna=$15, referencia=$16,
         marca=$17, marca_id=$18
       WHERE id=$19 AND empresa_id=$20 RETURNING *`,
      [nome.trim(), categoria || null, (fornecedor ? fornecedor.trim() : null), Number(precoCusto), Number(precoVenda),
       ncm ? String(ncm).replace(/\D/g, '') : null,
       cest ? String(cest).replace(/\D/g, '') : null,
       cfopPadrao || null,
       origemMercadoria || null,
       csosn || null,
       cst || null,
       unidadeTributavel || null,
       fotoUrl || null,
       descricaoImpressao ? String(descricaoImpressao).trim() : null,
       observacaoInterna ? String(observacaoInterna).trim() : null,
       referencia ? String(referencia).trim().toUpperCase() : null,
       marcaFinalNome,
       marcaFinalId,
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
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('referencia')) {
        return res.status(400).json({ error: 'Já existe outro produto com essa referência.' });
      }
      return res.status(400).json({ error: 'Já existe outro produto com esse nome.' });
    }
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

// ==========================================
// MIGRAÇÃO DE OUTRO SISTEMA (Iluminação)
// ==========================================
// Fluxo específico pra clientes migrando de outro ERP:
// - Fornecedor OPCIONAL (será preenchido nas entradas de mercadoria)
// - Cria marcas automaticamente se não existirem
// - Aceita colunas: codigo, referencia, nome, marca, quantidade, precoCusto, precoVenda
// - Detecta duplicatas por referência (chave principal em iluminação) ou nome
router.post('/migracao', async (req, res) => {
  const { itens } = req.body || {};

  // Só pra empresas com módulo iluminação
  const empChk = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
  if (!empChk.rows[0]?.usa_ambientes) {
    return res.status(403).json({ error: 'Migração disponível apenas com Módulo Iluminação ativo.' });
  }

  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ error: 'Nenhum produto recebido para migração.' });
  }
  if (itens.length > 5000) {
    return res.status(400).json({ error: 'Máximo de 5000 produtos por migração. Divida em lotes.' });
  }

  const client = await db.pool.connect();
  let criados = 0, atualizados = 0, ignorados = 0, marcasCriadas = 0;
  const erros = [];
  const marcasNovas = new Set();

  try {
    await client.query('BEGIN');

    // Cache de marcas existentes (nome lowercase → id)
    const rMarcas = await client.query(
      'SELECT id, nome FROM marcas WHERE empresa_id=$1',
      [req.user.empresaId]
    );
    const mapMarcas = new Map();
    for (const m of rMarcas.rows) {
      mapMarcas.set(String(m.nome).toLowerCase().trim(), m.id);
    }

    // Próximo código auto
    const r0 = await client.query(
      'SELECT codigo FROM produtos WHERE empresa_id = $1',
      [req.user.empresaId]
    );
    let proximoCodigo = 1000;
    for (const row of r0.rows) {
      if (row.codigo && /^\d+$/.test(row.codigo)) {
        const n = parseInt(row.codigo, 10);
        if (n > proximoCodigo) proximoCodigo = n;
      }
    }

    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      const linha = i + 2; // assume cabeçalho na linha 1
      try {
        const nome = String(it.nome || '').trim();
        if (!nome) {
          erros.push({ linha, motivo: 'Nome em branco' });
          ignorados++;
          continue;
        }

        const referencia = it.referencia ? String(it.referencia).trim().toUpperCase() : null;
        const codigo = it.codigo ? String(it.codigo).trim() : '';
        const categoria = it.categoria ? String(it.categoria).trim() : null;
        const marcaNome = it.marca ? String(it.marca).trim() : null;
        const estoque = Number(it.estoque) || 0;
        const precoCusto = Number(it.precoCusto) || 0;
        const precoVenda = Number(it.precoVenda) || 0;

        // Preço venda é obrigatório (sem preço, não pode vender)
        if (precoVenda <= 0) {
          erros.push({ linha, motivo: 'Preço de venda inválido ou zero' });
          ignorados++;
          continue;
        }

        // Resolve marca (cria se não existir)
        let marcaId = null;
        let marcaFinalNome = null;
        if (marcaNome) {
          const chaveMarca = marcaNome.toLowerCase();
          if (mapMarcas.has(chaveMarca)) {
            marcaId = mapMarcas.get(chaveMarca);
            marcaFinalNome = marcaNome;
          } else {
            // Cria marca automaticamente
            try {
              const rNovaMarca = await client.query(
                `INSERT INTO marcas (empresa_id, nome) VALUES ($1, $2)
                 ON CONFLICT (empresa_id, nome) DO UPDATE SET nome = EXCLUDED.nome
                 RETURNING id, nome`,
                [req.user.empresaId, marcaNome]
              );
              marcaId = rNovaMarca.rows[0].id;
              marcaFinalNome = rNovaMarca.rows[0].nome;
              mapMarcas.set(chaveMarca, marcaId);
              if (!marcasNovas.has(chaveMarca)) {
                marcasNovas.add(chaveMarca);
                marcasCriadas++;
              }
            } catch (eM) {
              console.warn('[migracao] Falha ao criar marca:', marcaNome, eM.message);
              marcaFinalNome = marcaNome; // salva pelo menos o texto
            }
          }
        }

        // Detecta duplicata: prefere referência (mais precisa), fallback pra nome
        let existente = null;
        if (referencia) {
          const rExist = await client.query(
            'SELECT id, codigo FROM produtos WHERE empresa_id=$1 AND UPPER(referencia)=UPPER($2) LIMIT 1',
            [req.user.empresaId, referencia]
          );
          existente = rExist.rows[0];
        }
        if (!existente) {
          const rExist = await client.query(
            'SELECT id, codigo FROM produtos WHERE empresa_id=$1 AND LOWER(nome)=LOWER($2) LIMIT 1',
            [req.user.empresaId, nome]
          );
          existente = rExist.rows[0];
        }

        if (existente) {
          // ATUALIZA: preços + marca + categoria + referência (mantém estoque + fornecedor)
          await client.query(
            `UPDATE produtos SET
               nome=$1,
               categoria=COALESCE($2, categoria),
               preco_custo=CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE preco_custo END,
               preco_venda=$4,
               referencia=COALESCE($5, referencia),
               marca=COALESCE($6, marca),
               marca_id=COALESCE($7, marca_id)
             WHERE id=$8 AND empresa_id=$9`,
            [nome, categoria, precoCusto, precoVenda, referencia, marcaFinalNome, marcaId, existente.id, req.user.empresaId]
          );
          atualizados++;
        } else {
          // NOVO produto
          let codigoFinal = codigo;
          if (!codigoFinal) {
            proximoCodigo++;
            codigoFinal = String(proximoCodigo);
          }
          // Verifica se código já existe (gera outro se sim)
          const dupCod = await client.query(
            'SELECT id FROM produtos WHERE empresa_id=$1 AND codigo=$2 LIMIT 1',
            [req.user.empresaId, codigoFinal]
          );
          if (dupCod.rows.length > 0) {
            proximoCodigo++;
            codigoFinal = String(proximoCodigo);
          }

          // Verifica se referência já existe (evita conflito unique)
          let referenciaFinal = referencia;
          if (referenciaFinal) {
            const dupRef = await client.query(
              'SELECT id FROM produtos WHERE empresa_id=$1 AND UPPER(referencia)=UPPER($2) LIMIT 1',
              [req.user.empresaId, referenciaFinal]
            );
            if (dupRef.rows.length > 0) {
              // Já existe - não vai criar duplicata; loga aviso e usa null pra referência
              referenciaFinal = null;
            }
          }

          const rIns = await client.query(
            `INSERT INTO produtos (
               empresa_id, codigo, nome, categoria, fornecedor, estoque,
               preco_custo, preco_venda, referencia, marca, marca_id
             ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10)
             RETURNING id, codigo, nome`,
            [req.user.empresaId, codigoFinal, nome, categoria, estoque,
             precoCusto, precoVenda, referenciaFinal, marcaFinalNome, marcaId]
          );

          // Auto-gera código de barras
          const codigoBarras = 'PRD-' + String(rIns.rows[0].id).padStart(6, '0');
          await client.query(
            'UPDATE produtos SET codigo_barras=$1 WHERE id=$2',
            [codigoBarras, rIns.rows[0].id]
          );

          // Movimentação de estoque inicial (se veio quantidade)
          if (estoque > 0) {
            await client.query(
              `INSERT INTO movimentacoes (empresa_id, produto_codigo, produto_nome, data, tipo, qtd, origem)
               VALUES ($1, $2, $3, CURRENT_DATE, 'entrada', $4, 'Migração de Sistema')`,
              [req.user.empresaId, rIns.rows[0].codigo, rIns.rows[0].nome, estoque]
            );
          }
          criados++;
        }
      } catch (e) {
        console.error(`[migracao] Linha ${linha}:`, e.message);
        erros.push({ linha, motivo: e.message || 'Erro desconhecido' });
        ignorados++;
      }
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      criados,
      atualizados,
      ignorados,
      marcasCriadas,
      total: itens.length,
      erros: erros.slice(0, 100) // limita retorno
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[produtos/migracao]', err);
    res.status(500).json({ error: 'Erro geral na migração: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
