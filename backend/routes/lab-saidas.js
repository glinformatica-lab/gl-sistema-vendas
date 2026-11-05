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
const formatarDataIso = (d) => {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10);
};

// Lista saidas da empresa
router.get('/', async (req, res) => {
  try {
    const { dataInicio, dataFim, incluirEstornadas } = req.query;
    const params = [req.user.empresaId];
    let where = 's.empresa_id = $1';
    if (dataInicio) { params.push(dataInicio); where += ` AND s.data >= $${params.length}`; }
    if (dataFim)    { params.push(dataFim);    where += ` AND s.data <= $${params.length}`; }
    if (incluirEstornadas !== '1') where += ' AND s.estornado_em IS NULL';
    const r = await db.query(
      `SELECT s.*, u1.nome AS usuario_nome, u2.nome AS estornado_por_nome
       FROM lab_saidas_estoque s
       LEFT JOIN usuarios u1 ON u1.id = s.usuario_id
       LEFT JOIN usuarios u2 ON u2.id = s.estornado_por_usuario_id
       WHERE ${where}
       ORDER BY s.data DESC, s.id DESC`,
      params
    );
    res.json(r.rows.map(row => ({ ...camelizar(row), qtd: toNum(row.qtd), data: formatarDataIso(row.data) })));
  } catch (err) {
    console.error('[lab-saidas/list]', err);
    res.status(500).json({ error: 'Erro ao listar saidas: ' + err.message });
  }
});

// Detalhe
router.get('/:id', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.*, u1.nome AS usuario_nome, u2.nome AS estornado_por_nome
       FROM lab_saidas_estoque s
       LEFT JOIN usuarios u1 ON u1.id = s.usuario_id
       LEFT JOIN usuarios u2 ON u2.id = s.estornado_por_usuario_id
       WHERE s.id = $1 AND s.empresa_id = $2`,
      [req.params.id, req.user.empresaId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Saida nao encontrada.' });
    const row = r.rows[0];
    res.json({ ...camelizar(row), qtd: toNum(row.qtd), data: formatarDataIso(row.data) });
  } catch (err) {
    console.error('[lab-saidas/get]', err);
    res.status(500).json({ error: 'Erro ao buscar saida.' });
  }
});

// Cria saida + baixa estoque
router.post('/', async (req, res) => {
  const { data, produtoId, produtoNome, qtd, entreguePor, recebidoPor, obs } = req.body || {};
  if (!qtd || Number(qtd) <= 0) return res.status(400).json({ error: 'Quantidade deve ser maior que zero.' });
  if (!produtoId && !(produtoNome && produtoNome.trim())) return res.status(400).json({ error: 'Informe o produto.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let nomeFinal = (produtoNome || '').trim();
    let obsFinal = obs || null;
    if (produtoId) {
      const prod = await client.query(
        'SELECT id, nome, estoque, validade FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
        [produtoId, req.user.empresaId]
      );
      if (prod.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Produto nao encontrado.' }); }
      const p = prod.rows[0];
      const estoqueAtual = Number(p.estoque) || 0;
      if (Number(qtd) > estoqueAtual) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Quantidade (' + qtd + ') maior que estoque atual (' + estoqueAtual + ') do produto "' + p.nome + '".' });
      }
      if (p.validade) {
        const hoje = new Date().toISOString().slice(0,10);
        const venc = formatarDataIso(p.validade);
        if (venc && venc < hoje) obsFinal = '[VENCIDO em ' + venc + '] ' + (obsFinal || '');
      }
      nomeFinal = p.nome;
      await client.query('UPDATE produtos SET estoque = estoque - $1 WHERE id = $2', [Number(qtd), produtoId]);
    }
    const ins = await client.query(
      `INSERT INTO lab_saidas_estoque
         (empresa_id, data, produto_id, produto_nome, qtd, entregue_por, recebido_por, obs, usuario_id)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.empresaId, data || null, produtoId || null, nomeFinal, Number(qtd),
       entreguePor || null, recebidoPor || null, obsFinal, req.user.id]
    );
    await client.query('COMMIT');
    const row = ins.rows[0];
    res.json({ ...camelizar(row), qtd: toNum(row.qtd), data: formatarDataIso(row.data) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[lab-saidas/create]', err);
    res.status(500).json({ error: 'Erro ao criar saida: ' + err.message });
  } finally {
    client.release();
  }
});

// Estorno (soft delete + devolve estoque)
router.post('/:id/estornar', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT id, produto_id, qtd, estornado_em FROM lab_saidas_estoque WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
      [req.params.id, req.user.empresaId]
    );
    if (r.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Saida nao encontrada.' }); }
    const s = r.rows[0];
    if (s.estornado_em) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Saida ja foi estornada.' }); }
    if (s.produto_id) {
      await client.query(
        'UPDATE produtos SET estoque = estoque + $1 WHERE id = $2 AND empresa_id = $3',
        [Number(s.qtd), s.produto_id, req.user.empresaId]
      );
    }
    const upd = await client.query(
      `UPDATE lab_saidas_estoque SET estornado_em = NOW(), estornado_por_usuario_id = $1
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await client.query('COMMIT');
    const row = upd.rows[0];
    res.json({ ...camelizar(row), qtd: toNum(row.qtd), data: formatarDataIso(row.data) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[lab-saidas/estornar]', err);
    res.status(500).json({ error: 'Erro ao estornar: ' + err.message });
  } finally {
    client.release();
  }
});

// Usuarios ativos da empresa (dropdown entregue_por)
router.get('/meta/usuarios', async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, nome FROM usuarios WHERE empresa_id = $1 ORDER BY nome',
      [req.user.empresaId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[lab-saidas/meta/usuarios]', err);
    res.status(500).json({ error: 'Erro ao listar usuarios.' });
  }
});

module.exports = router;
