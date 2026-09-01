// ============================================
// NOTAS FISCAIS DE SAÍDA (somente leitura)
// Feature: só módulo iluminação
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: requer módulo iluminação ativo
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.usa_ambientes) {
      return res.status(403).json({ error: 'Feature disponível apenas com Módulo Iluminação.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo: ' + e.message });
  }
}

router.use(requerAmbientes);

// ==========================================
// GET / — Lista paginada com filtros
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { de, ate, tipo, status, busca } = req.query;
    let pagina = parseInt(req.query.pagina) || 1;
    let porPagina = parseInt(req.query.porPagina) || 50;
    if (pagina < 1) pagina = 1;
    if (porPagina < 1 || porPagina > 500) porPagina = 50;

    const where = ['empresa_id = $1'];
    const vals = [req.user.empresaId];
    let idx = 2;

    // Filtro data
    if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) {
      where.push(`data >= $${idx++}`);
      vals.push(de);
    }
    if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      where.push(`data <= $${idx++}`);
      vals.push(ate);
    }

    // Filtro tipo
    if (tipo && ['venda', 'cupom', 'devolucao', 'remessa', 'transferencia'].includes(tipo)) {
      where.push(`tipo = $${idx++}`);
      vals.push(tipo);
    }

    // Filtro status
    if (status) {
      if (status === 'sem_nfe') {
        where.push(`status_nfe IS NULL`);
      } else if (['autorizada', 'cancelada', 'denegada'].includes(status)) {
        where.push(`status_nfe = $${idx++}`);
        vals.push(status);
      }
    }

    // Busca: numero, cliente (ILIKE) ou chave (igualdade exata)
    if (busca && busca.trim()) {
      const b = busca.trim();
      const chaveExata = b.replace(/\D/g, ''); // só dígitos pra comparar chave
      where.push(`(
        numero ILIKE $${idx} OR
        cliente ILIKE $${idx} OR
        chave = $${idx + 1}
      )`);
      vals.push(`%${b}%`);
      vals.push(chaveExata);
      idx += 2;
    }

    const whereSql = where.join(' AND ');

    // Consulta principal (com soma e count agregados)
    const rCount = await db.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(total), 0)::numeric AS soma_total
       FROM notas_saida WHERE ${whereSql}`,
      vals
    );
    const total = rCount.rows[0].total;
    const somaTotal = Number(rCount.rows[0].soma_total) || 0;

    // Lista paginada
    const offset = (pagina - 1) * porPagina;
    const rLista = await db.query(
      `SELECT id, venda_id, numero, serie, tipo, data, cliente, cfop,
              chave, status_nfe, total, total_produtos, icms, obs, codigo_legado, criada_em
       FROM notas_saida WHERE ${whereSql}
       ORDER BY data DESC, numero DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, porPagina, offset]
    );

    res.json({
      notas: rLista.rows,
      total,
      somaTotal,
      pagina,
      porPagina,
      totalPaginas: Math.ceil(total / porPagina)
    });
  } catch (err) {
    console.error('[notas-saida] GET /', err);
    res.status(500).json({ error: 'Erro ao listar notas: ' + err.message });
  }
});

// ==========================================
// GET /:id — Detalhe da nota + itens da venda vinculada
// ==========================================
// ==========================================
// GET /faturamento — Total de faturamento por período
// REGRA: somente notas de VENDA + CUPOM
//        NÃO conta devolução, remessa, transferência
//        Ignora canceladas e denegadas
// Query params: ?de=YYYY-MM-DD&ate=YYYY-MM-DD
// IMPORTANTE: declarada ANTES de /:id pra evitar conflito de rota
// ==========================================
router.get('/faturamento', async (req, res) => {
  try {
    const { de, ate } = req.query;
    const where = ['empresa_id = $1', `tipo IN ('venda', 'cupom')`,
                   `(status_nfe IS NULL OR status_nfe NOT IN ('cancelada', 'denegada'))`];
    const vals = [req.user.empresaId];
    let idx = 2;
    if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) {
      where.push(`data >= $${idx++}`);
      vals.push(de);
    }
    if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      where.push(`data <= $${idx++}`);
      vals.push(ate);
    }
    const r = await db.query(
      `SELECT
         COUNT(*)::int AS qtd_notas,
         COALESCE(SUM(total), 0)::numeric AS total_bruto,
         COALESCE(SUM(total_produtos), 0)::numeric AS total_produtos,
         COALESCE(SUM(icms), 0)::numeric AS total_icms,
         COUNT(*) FILTER (WHERE tipo='venda')::int AS qtd_venda,
         COUNT(*) FILTER (WHERE tipo='cupom')::int AS qtd_cupom
       FROM notas_saida WHERE ${where.join(' AND ')}`,
      vals
    );
    const row = r.rows[0];
    res.json({
      periodo: { de: de || null, ate: ate || null },
      qtdNotas: row.qtd_notas,
      qtdVenda: row.qtd_venda,
      qtdCupom: row.qtd_cupom,
      totalBruto: Number(row.total_bruto) || 0,
      totalProdutos: Number(row.total_produtos) || 0,
      totalIcms: Number(row.total_icms) || 0
    });
  } catch (err) {
    console.error('[notas-saida] GET /faturamento', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /:id — Detalhe da nota + itens da tabela notas_saida_itens
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

    const rNota = await db.query(
      `SELECT * FROM notas_saida WHERE id=$1 AND empresa_id=$2`,
      [id, req.user.empresaId]
    );
    if (rNota.rows.length === 0) {
      return res.status(404).json({ error: 'Nota não encontrada.' });
    }
    const nota = rNota.rows[0];

    // Busca ITENS DA NOTA (tabela nova notas_saida_itens)
    const rItens = await db.query(
      `SELECT ordem, codigo, descricao, quantidade, valor_unitario,
              desconto_item, total, unidade, cfop, ncm
         FROM notas_saida_itens
        WHERE nota_id = $1
        ORDER BY ordem NULLS LAST, id`,
      [id]
    );
    const itens = rItens.rows;

    // Busca info mínima da venda vinculada (só pra mostrar link)
    let venda = null;
    if (nota.venda_id) {
      const rVenda = await db.query(
        `SELECT id, data, cliente, total
         FROM vendas WHERE id=$1 AND empresa_id=$2`,
        [nota.venda_id, req.user.empresaId]
      );
      if (rVenda.rows.length > 0) {
        venda = rVenda.rows[0];
      }
    }

    res.json({ nota, itens, venda });
  } catch (err) {
    console.error('[notas-saida] GET /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
