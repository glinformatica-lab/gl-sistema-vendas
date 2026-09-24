// ============================================
// Sync bidirecional Local <-> Nuvem
// Autentica por token x-sync-token
// ============================================
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// -------------------------------------------
// Tabelas sincronizadas + suas colunas
// (importante: NÃO inclui id local, apenas sync_uuid + colunas de dado)
// -------------------------------------------
const TABELAS_SYNC = {
  clientes: {
    colunas: ['empresa_id', 'nome', 'doc', 'telefone', 'cep', 'endereco', 'bairro', 'cidade', 'uf',
              'e_tambem_fornecedor', 'credito_saldo', 'hiper_id_entidade', 'sync_uuid', 'updated_at']
  },
  fornecedores: {
    colunas: ['empresa_id', 'nome', 'doc', 'telefone', 'cidade', 'email', 'inscricao_estadual',
              'hiper_id_entidade', 'sync_uuid', 'updated_at']
  },
  transportadoras: {
    colunas: ['empresa_id', 'nome', 'cnpj', 'telefone', 'email', 'endereco', 'bairro', 'cidade',
              'uf', 'cep', 'contato', 'observacao', 'ativo', 'inscricao_estadual',
              'hiper_id_entidade', 'sync_uuid', 'updated_at']
  },
  produtos: {
    colunas: ['empresa_id', 'codigo', 'nome', 'categoria', 'fornecedor', 'estoque', 'preco_custo',
              'preco_venda', 'ncm', 'cest', 'cfop_padrao', 'origem_mercadoria', 'csosn', 'cst',
              'unidade_tributavel', 'foto_url', 'descricao_impressao', 'observacao_interna',
              'referencia', 'codigo_barras', 'marca_id', 'marca', 'preco_hiper', 'estoque_hiper',
              'moeda_origem', 'preco_custo_origem', 'cotacao_usada', 'cotacao_data',
              'sync_uuid', 'updated_at']
  },
  vendas: {
    colunas: null  // preenche em runtime via information_schema
  },
  venda_itens: { colunas: null },
  movimentacoes: { colunas: null },
  orcamentos: { colunas: null },
  orcamento_itens: { colunas: null },
  contas_pagar: { colunas: null },
  contas_receber: { colunas: null },
  entradas: { colunas: null },
  entrada_itens: { colunas: null },
  servicos: { colunas: null },
  marcas: { colunas: null }
};

// Cache de colunas descobertas em runtime
const colunasCache = {};

async function pegarColunas(tabela) {
  if (colunasCache[tabela]) return colunasCache[tabela];
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND column_name NOT IN ('id', 'criado_em', 'atualizado_em')`,
    [tabela]
  );
  colunasCache[tabela] = r.rows.map(x => x.column_name);
  return colunasCache[tabela];
}

// Verifica se a tabela é sincronizável (tem sync_uuid + empresa_id + updated_at)
async function tabelaValida(tabela) {
  const cols = await pegarColunas(tabela);
  return cols.includes('sync_uuid') && cols.includes('empresa_id') && cols.includes('updated_at');
}

// -------------------------------------------
// Middleware de autenticação
// -------------------------------------------
router.use(async (req, res, next) => {
  const token = req.headers['x-sync-token'];
  if (!token) return res.status(401).json({ error: 'x-sync-token ausente' });
  try {
    const r = await pool.query(
      `SELECT empresa_id FROM sync_tokens WHERE token = $1`,
      [token]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'Token de sync inválido' });
    req.empresaId = r.rows[0].empresa_id;
    // Atualiza último uso
    pool.query('UPDATE sync_tokens SET ultimo_uso = NOW() WHERE token = $1', [token])
      .catch(() => {});
    next();
  } catch (err) {
    console.error('[sync] auth error:', err.message);
    res.status(500).json({ error: 'Erro de auth' });
  }
});

// -------------------------------------------
// GET /ping
// -------------------------------------------
router.get('/ping', (req, res) => {
  res.json({ ok: true, empresaId: req.empresaId, ts: new Date().toISOString() });
});

// -------------------------------------------
// GET /tables — lista tabelas sincronizáveis
// -------------------------------------------
router.get('/tables', (req, res) => {
  res.json({ tables: Object.keys(TABELAS_SYNC) });
});

// -------------------------------------------
// GET /pull?table=X&since=TIMESTAMP
// Retorna registros da tabela X modificados desde SINCE
// -------------------------------------------
router.get('/pull', async (req, res) => {
  const { table, since, limit = 500 } = req.query;
  const empresaId = req.empresaId;

  if (!TABELAS_SYNC[table]) {
    return res.status(400).json({ error: 'Tabela não sincronizada' });
  }

  const t0 = Date.now();
  try {
    if (!(await tabelaValida(table))) {
      // Retorna vazio ao invés de erro (compatibilidade)
      return res.json({ table, records: [], lastUpdatedAt: since || '1970-01-01', count: 0, hasMore: false });
    }
    const cols = await pegarColunas(table);
    const sinceStr = since || '1970-01-01';
    const r = await pool.query(
      `SELECT ${cols.map(c => `"${c}"`).join(', ')}
       FROM "${table}"
       WHERE empresa_id = $1 AND updated_at > $2
       ORDER BY updated_at ASC
       LIMIT $3`,
      [empresaId, sinceStr, Math.min(Number(limit) || 500, 5000)]
    );

    // Última updated_at do lote (pro cliente saber onde parou)
    const ultimo = r.rows.length ? r.rows[r.rows.length - 1].updated_at : sinceStr;

    // Log
    pool.query(
      `INSERT INTO sync_log (empresa_id, direcao, tabela, registros, duracao_ms, status)
       VALUES ($1, 'down', $2, $3, $4, 'ok')`,
      [empresaId, table, r.rows.length, Date.now() - t0]
    ).catch(() => {});

    res.json({
      table,
      records: r.rows,
      lastUpdatedAt: ultimo,
      count: r.rows.length,
      hasMore: r.rows.length >= (Number(limit) || 500)
    });
  } catch (err) {
    console.error(`[sync/pull] ${table}:`, err.message);
    pool.query(
      `INSERT INTO sync_log (empresa_id, direcao, tabela, status, erro)
       VALUES ($1, 'down', $2, 'erro', $3)`,
      [empresaId, table, err.message]
    ).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------
// POST /push
// Body: { table, records: [{sync_uuid, ...campos}] }
// Faz UPSERT por sync_uuid, last-write-wins por updated_at
// -------------------------------------------
router.post('/push', async (req, res) => {
  const { table, records = [] } = req.body || {};
  const empresaId = req.empresaId;

  if (!TABELAS_SYNC[table]) {
    return res.status(400).json({ error: 'Tabela não sincronizada' });
  }
  if (!Array.isArray(records) || !records.length) {
    return res.json({ inseridos: 0, atualizados: 0, ignorados: 0 });
  }

  const t0 = Date.now();
  let inseridos = 0, atualizados = 0, ignorados = 0;
  const erros = [];

  if (!(await tabelaValida(table))) {
    return res.json({ inseridos: 0, atualizados: 0, ignorados: records.length, erros: [] });
  }

  const cols = await pegarColunas(table);
  const semSyncCols = cols.filter(c => c !== 'sync_uuid');

  try {
    for (const rec of records) {
      try {
        if (!rec.sync_uuid) { ignorados++; continue; }
        // Força empresa_id do token (não confia no body)
        rec.empresa_id = empresaId;

        // Existe?
        const existe = await pool.query(
          `SELECT id, updated_at FROM "${table}" WHERE sync_uuid = $1 AND empresa_id = $2`,
          [rec.sync_uuid, empresaId]
        );

        if (existe.rowCount) {
          // Last-write-wins: só atualiza se o incoming for mais novo
          const localUp = new Date(existe.rows[0].updated_at);
          const incoming = new Date(rec.updated_at || new Date());
          if (incoming <= localUp) { ignorados++; continue; }

          // UPDATE dinâmico
          const sets = [];
          const vals = [];
          let i = 1;
          for (const c of semSyncCols) {
            if (rec[c] !== undefined) {
              sets.push(`"${c}" = $${i++}`);
              vals.push(rec[c]);
            }
          }
          vals.push(rec.sync_uuid, empresaId);
          if (sets.length) {
            await pool.query(
              `UPDATE "${table}" SET ${sets.join(', ')} WHERE sync_uuid = $${i++} AND empresa_id = $${i}`,
              vals
            );
            atualizados++;
          } else {
            ignorados++;
          }
        } else {
          // INSERT
          const insCols = cols.filter(c => rec[c] !== undefined);
          const insVals = insCols.map(c => rec[c]);
          const placeholders = insCols.map((_, i) => `$${i + 1}`);
          await pool.query(
            `INSERT INTO "${table}" (${insCols.map(c => `"${c}"`).join(', ')})
             VALUES (${placeholders.join(', ')})`,
            insVals
          );
          inseridos++;
        }
      } catch (err) {
        ignorados++;
        erros.push({ sync_uuid: rec.sync_uuid, err: err.message });
        if (erros.length > 20) break;
      }
    }

    // Log
    pool.query(
      `INSERT INTO sync_log (empresa_id, direcao, tabela, registros, duracao_ms, status, erro)
       VALUES ($1, 'up', $2, $3, $4, $5, $6)`,
      [empresaId, table, records.length, Date.now() - t0,
       erros.length ? 'parcial' : 'ok',
       erros.length ? JSON.stringify(erros.slice(0, 5)) : null]
    ).catch(() => {});

    res.json({ inseridos, atualizados, ignorados, erros: erros.slice(0, 20) });
  } catch (err) {
    console.error(`[sync/push] ${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
