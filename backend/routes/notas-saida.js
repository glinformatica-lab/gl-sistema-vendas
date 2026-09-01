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
    if (tipo && ['venda', 'devolucao', 'cupom', 'transferencia'].includes(tipo)) {
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

    // Busca dados da venda vinculada (se houver)
    let venda = null;
    if (nota.venda_id) {
      const rVenda = await db.query(
        `SELECT id, data, cliente, total, itens, pagamento, parcelas, obs
         FROM vendas WHERE id=$1 AND empresa_id=$2`,
        [nota.venda_id, req.user.empresaId]
      );
      if (rVenda.rows.length > 0) {
        venda = rVenda.rows[0];
      }
    }

    res.json({ nota, venda });
  } catch (err) {
    console.error('[notas-saida] GET /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
