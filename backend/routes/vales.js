// ============================================
// VALES DA PROFISSIONAL
// Adiantamentos que a dona dá durante o mês.
// Vale trancado (fechamento_id != null) NÃO pode ser editado.
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

async function requerSalao(req, res, next) {
  try {
    const r = await db.query('SELECT modulo_salao FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.modulo_salao) {
      return res.status(403).json({ error: 'Feature disponível apenas com Módulo Salão.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro: ' + e.message });
  }
}
router.use(requerSalao);

function camelizar(row) {
  const out = {};
  for (const k in row) {
    out[k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())] = row[k];
  }
  return out;
}
function montar(row) {
  const obj = camelizar(row);
  if (obj.data instanceof Date) obj.data = obj.data.toISOString().slice(0, 10);
  return obj;
}

// ==========================================
// GET / — Lista vales
// Query params: ?profissionalId=&de=&ate=&somenteAbertos=
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { profissionalId, de, ate, somenteAbertos } = req.query;
    const where = ['v.empresa_id = $1'];
    const vals = [req.user.empresaId];
    let idx = 2;
    if (profissionalId) { where.push(`v.profissional_id = $${idx++}`); vals.push(parseInt(profissionalId)); }
    if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) { where.push(`v.data >= $${idx++}`); vals.push(de); }
    if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) { where.push(`v.data <= $${idx++}`); vals.push(ate); }
    if (somenteAbertos === 'true') where.push('v.fechamento_id IS NULL');

    const r = await db.query(
      `SELECT v.*, p.nome AS profissional_nome
       FROM vales_profissional v
       JOIN profissionais p ON p.id = v.profissional_id
       WHERE ${where.join(' AND ')}
       ORDER BY v.data DESC, v.id DESC LIMIT 500`,
      vals
    );
    res.json(r.rows.map(montar));
  } catch (err) {
    console.error('[vales] GET /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST / — Registrar vale
// ==========================================
router.post('/', async (req, res) => {
  try {
    const { profissionalId, data, valor, observacao } = req.body || {};
    if (!profissionalId) return res.status(400).json({ error: 'Profissional é obrigatória.' });
    const v = Number(valor);
    if (!v || v <= 0) return res.status(400).json({ error: 'Valor deve ser positivo.' });

    const r = await db.query(
      `INSERT INTO vales_profissional
         (empresa_id, profissional_id, data, valor, observacao, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.user.empresaId,
        parseInt(profissionalId),
        data || null,   // usa CURRENT_DATE se null
        v,
        observacao || null,
        req.user.userId || null
      ]
    );
    res.status(201).json(montar(r.rows[0]));
  } catch (err) {
    console.error('[vales] POST /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// PUT /:id — Editar (só se ainda não fechou o mês)
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data, valor, observacao } = req.body || {};
    const v = Number(valor);
    if (!v || v <= 0) return res.status(400).json({ error: 'Valor deve ser positivo.' });

    // Verifica se já foi fechado
    const chk = await db.query(
      'SELECT fechamento_id FROM vales_profissional WHERE id=$1 AND empresa_id=$2',
      [id, req.user.empresaId]
    );
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Vale não encontrado.' });
    if (chk.rows[0].fechamento_id) {
      return res.status(400).json({ error: 'Este vale já foi incluído num fechamento. Não pode ser editado.' });
    }

    const r = await db.query(
      `UPDATE vales_profissional SET data=$1, valor=$2, observacao=$3
       WHERE id=$4 AND empresa_id=$5 RETURNING *`,
      [data || null, v, observacao || null, id, req.user.empresaId]
    );
    res.json(montar(r.rows[0]));
  } catch (err) {
    console.error('[vales] PUT /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// DELETE /:id — Apagar (só se ainda não fechou)
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const chk = await db.query(
      'SELECT fechamento_id FROM vales_profissional WHERE id=$1 AND empresa_id=$2',
      [id, req.user.empresaId]
    );
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Vale não encontrado.' });
    if (chk.rows[0].fechamento_id) {
      return res.status(400).json({ error: 'Este vale já foi incluído num fechamento. Não pode ser apagado.' });
    }
    await db.query('DELETE FROM vales_profissional WHERE id=$1 AND empresa_id=$2', [id, req.user.empresaId]);
    res.json({ ok: true, mensagem: 'Vale apagado.' });
  } catch (err) {
    console.error('[vales] DELETE /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
