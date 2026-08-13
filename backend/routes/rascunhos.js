// ============================================
// RASCUNHOS AUTOMÁTICOS
// Salva formulários em progresso pra recuperação
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /:tipoForm — Recupera o rascunho ativo do usuário para um tipo de formulário
// Query opcional: ?chave=X (pra diferenciar múltiplos rascunhos)
router.get('/:tipoForm', async (req, res) => {
  const { tipoForm } = req.params;
  const chave = req.query.chave || '';
  try {
    const r = await db.query(
      `SELECT id, conteudo, atualizado_em, criado_em
       FROM rascunhos
       WHERE empresa_id=$1 AND usuario_id=$2 AND tipo_form=$3 AND COALESCE(chave, '')=$4`,
      [req.user.empresaId, req.user.userId, tipoForm, chave]
    );
    if (r.rows.length === 0) return res.json({ existe: false });
    res.json({
      existe: true,
      conteudo: r.rows[0].conteudo,
      atualizadoEm: r.rows[0].atualizado_em,
      criadoEm: r.rows[0].criado_em
    });
  } catch (err) {
    console.error('[rascunhos] GET', err);
    res.status(500).json({ error: 'Erro ao carregar rascunho.' });
  }
});

// POST /:tipoForm — Salva ou atualiza rascunho (upsert)
// Body: { conteudo: {...}, chave: 'opcional' }
router.post('/:tipoForm', async (req, res) => {
  const { tipoForm } = req.params;
  const { conteudo, chave } = req.body || {};

  if (!conteudo || typeof conteudo !== 'object') {
    return res.status(400).json({ error: 'Conteúdo inválido.' });
  }

  // Limita tamanho pra evitar abuso (JSON maior que ~500KB)
  const size = JSON.stringify(conteudo).length;
  if (size > 500000) {
    return res.status(400).json({ error: 'Rascunho muito grande.' });
  }

  try {
    // UPSERT usando ON CONFLICT
    const r = await db.query(
      `INSERT INTO rascunhos (empresa_id, usuario_id, tipo_form, chave, conteudo, atualizado_em)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (empresa_id, usuario_id, tipo_form, chave)
       DO UPDATE SET conteudo = EXCLUDED.conteudo, atualizado_em = NOW()
       RETURNING id, atualizado_em`,
      [req.user.empresaId, req.user.userId, tipoForm, chave || '', JSON.stringify(conteudo)]
    );
    res.json({ ok: true, id: r.rows[0].id, atualizadoEm: r.rows[0].atualizado_em });
  } catch (err) {
    console.error('[rascunhos] POST', err);
    res.status(500).json({ error: 'Erro ao salvar rascunho.' });
  }
});

// DELETE /:tipoForm — Limpa rascunho (chamar após save bem-sucedido)
router.delete('/:tipoForm', async (req, res) => {
  const { tipoForm } = req.params;
  const chave = req.query.chave || '';
  try {
    await db.query(
      `DELETE FROM rascunhos
       WHERE empresa_id=$1 AND usuario_id=$2 AND tipo_form=$3 AND COALESCE(chave, '')=$4`,
      [req.user.empresaId, req.user.userId, tipoForm, chave]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[rascunhos] DELETE', err);
    res.status(500).json({ error: 'Erro ao limpar rascunho.' });
  }
});

// Limpeza automática de rascunhos antigos (>30 dias sem atualização)
// Chamado periodicamente
async function limparAntigos() {
  try {
    const r = await db.query(
      `DELETE FROM rascunhos WHERE atualizado_em < NOW() - INTERVAL '30 days'`
    );
    if (r.rowCount > 0) {
      console.log(`[rascunhos] Limpeza: ${r.rowCount} rascunho(s) antigos removidos.`);
    }
  } catch (err) {
    console.error('[rascunhos] limparAntigos', err);
  }
}
// Roda 1x/dia
setInterval(limparAntigos, 24 * 60 * 60 * 1000);
// E 30s depois do start
setTimeout(limparAntigos, 30000);

module.exports = router;
