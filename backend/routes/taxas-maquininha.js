// ============================================
// TAXAS DE MAQUININHA (por forma de pagamento)
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
    res.status(500).json({ error: 'Erro ao verificar módulo: ' + e.message });
  }
}
router.use(requerSalao);

const FORMAS_VALIDAS = ['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'outros'];

// ==========================================
// GET / — Lista todas as taxas configuradas
// ==========================================
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM taxas_maquininha WHERE empresa_id=$1 ORDER BY forma_pagamento`,
      [req.user.empresaId]
    );
    // Sempre retorna as formas conhecidas, mesmo se não configuradas (com 0%)
    const configuradas = {};
    r.rows.forEach(row => { configuradas[row.forma_pagamento] = Number(row.taxa_percentual); });
    const resposta = FORMAS_VALIDAS.map(forma => ({
      formaPagamento: forma,
      taxaPercentual: configuradas[forma] ?? 0
    }));
    res.json(resposta);
  } catch (err) {
    console.error('[taxas-maquininha] GET /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// PUT / — Atualiza taxas em lote (upsert)
// Body: [{ formaPagamento, taxaPercentual }]
// ==========================================
router.put('/', async (req, res) => {
  try {
    const taxas = Array.isArray(req.body) ? req.body : [];
    if (taxas.length === 0) return res.status(400).json({ error: 'Envie um array de taxas.' });

    for (const t of taxas) {
      if (!FORMAS_VALIDAS.includes(t.formaPagamento)) continue;
      const taxa = Number(t.taxaPercentual) || 0;
      await db.query(
        `INSERT INTO taxas_maquininha (empresa_id, forma_pagamento, taxa_percentual)
         VALUES ($1, $2, $3)
         ON CONFLICT (empresa_id, forma_pagamento)
         DO UPDATE SET taxa_percentual = EXCLUDED.taxa_percentual`,
        [req.user.empresaId, t.formaPagamento, taxa]
      );
    }
    res.json({ ok: true, mensagem: 'Taxas atualizadas.' });
  } catch (err) {
    console.error('[taxas-maquininha] PUT /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
