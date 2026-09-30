// ============================================
// Rotas do Agent Local do Hiper (autenticadas via x-agent-token)
// v52 — cria + ATUALIZA cadastros + transportadoras + estoque
// OBS: transportadoras usa `cnpj` (não `doc`) e tem endereço completo
// ============================================
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// -------------------------------------------
// Middleware de autenticação por token
// -------------------------------------------
router.use(async (req, res, next) => {
  const token = req.headers['x-agent-token'];
  if (!token) return res.status(401).json({ error: 'x-agent-token ausente' });
  try {
    const r = await pool.query(
      `SELECT e.id FROM empresas e
       INNER JOIN hiper_config hc ON hc.empresa_id = e.id
       WHERE hc.token_agent = $1 AND hc.ativo = true`,
      [token]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'Token inválido ou módulo desativado' });
    req.empresaId = r.rows[0].id;
    next();
  } catch (err) {
    console.error('[hiper-agent] auth error:', err.message);
    res.status(500).json({ error: 'Erro de autenticação' });
  }
});

// -------------------------------------------
// GET /ping — teste de conexao + sinaliza forcar sync
// -------------------------------------------
router.get('/ping', async (req, res) => {
  try {
    await pool.query(
      'UPDATE hiper_config SET ultimo_ping_agent = NOW() WHERE empresa_id = $1',
      [req.empresaId]
    );
    const r = await pool.query(
      `SELECT forcar_sync_em FROM hiper_config
       WHERE empresa_id = $1
         AND forcar_sync_em IS NOT NULL
         AND forcar_sync_em > NOW() - INTERVAL '1 hour'`,
      [req.empresaId]
    );
    res.json({
      ok: true,
      empresaId: req.empresaId,
      ts: new Date().toISOString(),
      forcarSync: r.rowCount > 0
    });
  } catch (err) {
    console.error('[hiper-agent] ping error:', err.message);
    res.json({ ok: true, empresaId: req.empresaId, ts: new Date().toISOString(), forcarSync: false });
  }
});

// -------------------------------------------
// POST /confirmar-sync - agent limpa flag forcar_sync_em depois de rodar
// -------------------------------------------
router.post('/confirmar-sync', async (req, res) => {
  try {
    await pool.query(
      'UPDATE hiper_config SET forcar_sync_em = NULL WHERE empresa_id = $1',
      [req.empresaId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------
// POST /produtos-completos
// Cria produtos novos e ATUALIZA existentes (nome, ncm, custo, peso)
// NUNCA sobrescreve preço de venda (esse é o preço fiscal do GL)
// SEMPRE atualiza preco_hiper (informativo)
// -------------------------------------------
router.post('/produtos-completos', async (req, res) => {
  const { produtos = [] } = req.body || {};
  const empresaId = req.empresaId;
  let criados = 0, atualizados = 0, erros = 0;
  const errosDetalhes = [];

  for (const p of produtos) {
    try {
      if (!p.codigo || !p.nome) {
        erros++;
        errosDetalhes.push({ codigo: p.codigo, err: 'codigo ou nome faltando' });
        continue;
      }
      const codigo = String(p.codigo);
      const precoCusto = Number(p.precoCusto) || 0;
      const precoVenda = Number(p.precoVenda) || 0;
      const peso = Number(p.peso) || 0;
      const precoHiper = precoVenda;

      const existe = await pool.query(
        'SELECT id FROM produtos WHERE empresa_id=$1 AND codigo=$2',
        [empresaId, codigo]
      );

      if (existe.rowCount) {
        // UPDATE (menos preco_venda que fica intacto no GL)
        await pool.query(`
          UPDATE produtos SET
            nome            = $2,
            ncm             = COALESCE(NULLIF($3,''), ncm),
            preco_custo     = $4,
            preco_hiper     = $5,
            preco_hiper_sync_em = NOW()
          WHERE empresa_id  = $1 AND codigo = $6
        `, [empresaId, p.nome, p.ncm || '', precoCusto, precoHiper, codigo]);
        atualizados++;
      } else {
        // INSERT (primeiro sync — usa preço Hiper como preço venda inicial)
        await pool.query(`
          INSERT INTO produtos
            (empresa_id, codigo, nome, ncm, preco_custo, preco_venda, preco_hiper, preco_hiper_sync_em)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [empresaId, codigo, p.nome, p.ncm || null, precoCusto, precoVenda, precoHiper]);
        criados++;
      }
    } catch (err) {
      erros++;
      errosDetalhes.push({ codigo: p.codigo, err: err.message });
    }
  }

  // Registra no log
  try {
    await pool.query(
      `INSERT INTO hiper_log_sync (empresa_id, tipo, fonte, status, qtd_criados, qtd_atualizados, qtd_erros, mensagem, executado_em)
       VALUES ($1, 'produtos', 'agent', $2, $3, $4, $5, $6, NOW())`,
      [empresaId, erros === 0 ? 'ok' : 'erro', criados, atualizados, erros,
       `${criados} criados, ${atualizados} atualizados, ${erros} erros`]
    );
  } catch (logErr) { console.error('[hiper-agent] log produtos:', logErr.message); }

  res.json({ criados, atualizados, erros, errosDetalhes: errosDetalhes.slice(0, 20) });
});

// -------------------------------------------
// POST /entidades-completas
// Cria + ATUALIZA clientes, fornecedores e transportadoras
// -------------------------------------------
router.post('/entidades-completas', async (req, res) => {
  const { entidades = [] } = req.body || {};
  const empresaId = req.empresaId;
  const stats = {
    clientesCriados: 0, clientesAtualizados: 0,
    fornecedoresCriados: 0, fornecedoresAtualizados: 0,
    transportadorasCriadas: 0, transportadorasAtualizadas: 0,
    erros: 0,
    errosDetalhes: []
  };

  // Helper: acha id na tabela por hiper_id_entidade OU por documento
  async function acharExistente(tabela, colDoc, empresaId, hiperId, doc) {
    // 1) prioridade: match por hiper_id_entidade
    if (hiperId) {
      const r = await pool.query(
        `SELECT id FROM ${tabela} WHERE empresa_id=$1 AND hiper_id_entidade=$2`,
        [empresaId, hiperId]
      );
      if (r.rowCount) return r.rows[0].id;
    }
    // 2) fallback: match por documento (registros antigos sem hiper_id preenchido)
    if (doc) {
      const r = await pool.query(
        `SELECT id FROM ${tabela} WHERE empresa_id=$1 AND ${colDoc}=$2 AND (hiper_id_entidade IS NULL OR hiper_id_entidade=$3)`,
        [empresaId, doc, hiperId || null]
      );
      if (r.rowCount) return r.rows[0].id;
    }
    return null;
  }

  for (const e of entidades) {
    try {
      if (!e.nome) {
        stats.erros++;
        stats.errosDetalhes.push({ nome: '(sem nome)', err: 'nome faltando' });
        continue;
      }
      const doc = e.doc ? String(e.doc).replace(/\D/g, '') : null;
      const hiperId = e.hiperId ? parseInt(e.hiperId) : null;

      // Precisa ter pelo menos hiperId OU doc pra fazer match confiável
      if (!hiperId && !doc) continue;

      // -------- CLIENTE --------
      if (e.eCliente) {
        const id = await acharExistente('clientes', 'doc', empresaId, hiperId, doc);
        if (id) {
          await pool.query(`
            UPDATE clientes SET
              nome                = $2,
              doc                 = COALESCE(NULLIF($3,''), doc),
              telefone            = COALESCE(NULLIF($4,''), telefone),
              cep                 = COALESCE(NULLIF($5,''), cep),
              endereco            = COALESCE(NULLIF($6,''), endereco),
              bairro              = COALESCE(NULLIF($7,''), bairro),
              cidade              = COALESCE(NULLIF($8,''), cidade),
              uf                  = COALESCE(NULLIF($9,''), uf),
              e_tambem_fornecedor = $10,
              hiper_id_entidade   = COALESCE(hiper_id_entidade, $11)
            WHERE id = $1
          `, [id, e.nome, doc || '', e.telefone || '', e.cep || '', e.endereco || '',
              e.bairro || '', e.cidade || '', e.uf || '', !!e.eFornecedor, hiperId]);
          stats.clientesAtualizados++;
        } else {
          await pool.query(`
            INSERT INTO clientes
              (empresa_id, nome, doc, telefone, cep, endereco, bairro, cidade, uf, e_tambem_fornecedor, hiper_id_entidade)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [empresaId, e.nome, doc || null, e.telefone || null, e.cep || null,
              e.endereco || null, e.bairro || null, e.cidade || null, e.uf || null,
              !!e.eFornecedor, hiperId]);
          stats.clientesCriados++;
        }
      }

      // -------- FORNECEDOR --------
      if (e.eFornecedor) {
        const id = await acharExistente('fornecedores', 'doc', empresaId, hiperId, doc);
        if (id) {
          await pool.query(`
            UPDATE fornecedores SET
              nome               = $2,
              doc                = COALESCE(NULLIF($3,''), doc),
              telefone           = COALESCE(NULLIF($4,''), telefone),
              cidade             = COALESCE(NULLIF($5,''), cidade),
              email              = COALESCE(NULLIF($6,''), email),
              inscricao_estadual = COALESCE(NULLIF($7,''), inscricao_estadual),
              hiper_id_entidade  = COALESCE(hiper_id_entidade, $8)
            WHERE id = $1
          `, [id, e.nome, doc || '', e.telefone || '', e.cidade || '',
              e.email || '', e.inscricaoEstadual || '', hiperId]);
          stats.fornecedoresAtualizados++;
        } else {
          await pool.query(`
            INSERT INTO fornecedores
              (empresa_id, nome, doc, telefone, cidade, email, inscricao_estadual, hiper_id_entidade)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [empresaId, e.nome, doc || null, e.telefone || null, e.cidade || null,
              e.email || null, e.inscricaoEstadual || null, hiperId]);
          stats.fornecedoresCriados++;
        }
      }

      // -------- TRANSPORTADORA --------
      if (e.eTransportadora) {
        const id = await acharExistente('transportadoras', 'cnpj', empresaId, hiperId, doc);
        if (id) {
          await pool.query(`
            UPDATE transportadoras SET
              nome               = $2,
              cnpj               = COALESCE(NULLIF($3,''), cnpj),
              telefone           = COALESCE(NULLIF($4,''), telefone),
              email              = COALESCE(NULLIF($5,''), email),
              endereco           = COALESCE(NULLIF($6,''), endereco),
              bairro             = COALESCE(NULLIF($7,''), bairro),
              cidade             = COALESCE(NULLIF($8,''), cidade),
              uf                 = COALESCE(NULLIF($9,''), uf),
              cep                = COALESCE(NULLIF($10,''), cep),
              inscricao_estadual = COALESCE(NULLIF($11,''), inscricao_estadual),
              hiper_id_entidade  = COALESCE(hiper_id_entidade, $12),
              atualizado_em      = NOW()
            WHERE id = $1
          `, [id, e.nome, doc || '', e.telefone || '', e.email || '',
              e.endereco || '', e.bairro || '', e.cidade || '', e.uf || '',
              e.cep || '', e.inscricaoEstadual || '', hiperId]);
          stats.transportadorasAtualizadas++;
        } else {
          await pool.query(`
            INSERT INTO transportadoras
              (empresa_id, nome, cnpj, telefone, email, endereco, bairro, cidade, uf, cep, inscricao_estadual, hiper_id_entidade, ativo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
          `, [empresaId, e.nome, doc || null, e.telefone || null, e.email || null,
              e.endereco || null, e.bairro || null, e.cidade || null,
              e.uf || null, e.cep || null, e.inscricaoEstadual || null, hiperId]);
          stats.transportadorasCriadas++;
        }
      }
    } catch (err) {
      stats.erros++;
      stats.errosDetalhes.push({ nome: e.nome, err: err.message });
    }
  }

  // Registra no log
  const msg =
    `Cli: ${stats.clientesCriados}c/${stats.clientesAtualizados}u, ` +
    `Forn: ${stats.fornecedoresCriados}c/${stats.fornecedoresAtualizados}u, ` +
    `Transp: ${stats.transportadorasCriadas}c/${stats.transportadorasAtualizadas}u, ` +
    `Err: ${stats.erros}`;
  const totalCriados = stats.clientesCriados + stats.fornecedoresCriados + stats.transportadorasCriadas;
  const totalAtualizados = stats.clientesAtualizados + stats.fornecedoresAtualizados + stats.transportadorasAtualizadas;
  try {
    await pool.query(
      `INSERT INTO hiper_log_sync (empresa_id, tipo, fonte, status, qtd_criados, qtd_atualizados, qtd_erros, mensagem, executado_em)
       VALUES ($1, 'entidades', 'agent', $2, $3, $4, $5, $6, NOW())`,
      [empresaId, stats.erros === 0 ? 'ok' : 'erro', totalCriados, totalAtualizados, stats.erros, msg]
    );
  } catch (logErr) { console.error('[hiper-agent] log entidades:', logErr.message); }

  stats.errosDetalhes = stats.errosDetalhes.slice(0, 20);
  res.json(stats);
});

// -------------------------------------------
// POST /estoque
// Recebe [{codigo, quantidade}] e atualiza SOMENTE estoque_hiper
// -------------------------------------------
router.post('/estoque', async (req, res) => {
  const { estoque = [] } = req.body || {};
  const empresaId = req.empresaId;
  let atualizados = 0, ignorados = 0;

  for (const item of estoque) {
    try {
      const codigo = String(item.codigo);
      const qtd = Number(item.quantidade) || 0;
      const r = await pool.query(`
        UPDATE produtos
        SET estoque_hiper = $1, estoque_hiper_sync_em = NOW()
        WHERE empresa_id = $2 AND codigo = $3
      `, [qtd, empresaId, codigo]);
      if (r.rowCount) atualizados++;
      else ignorados++;
    } catch (err) {
      ignorados++;
    }
  }

  try {
    await pool.query(
      `INSERT INTO hiper_log_sync (empresa_id, tipo, fonte, status, qtd_criados, qtd_atualizados, qtd_erros, mensagem, executado_em)
       VALUES ($1, 'estoque', 'agent', 'ok', 0, $2, $3, $4, NOW())`,
      [empresaId, atualizados, ignorados, `${atualizados} atualizados, ${ignorados} sem match`]
    );
  } catch (logErr) { console.error('[hiper-agent] log estoque:', logErr.message); }

  res.json({ atualizados, ignorados });
});

// -------------------------------------------
// POST /schema — recebe schema descoberto pelo agent (opcional)
// -------------------------------------------
router.post('/schema', async (req, res) => {
  console.log(`[hiper-agent] schema recebido de empresa ${req.empresaId}`);
  res.json({ ok: true });
});

// -------------------------------------------
// POST /upload — legado (compatibilidade)
// -------------------------------------------
router.post('/upload', async (req, res) => {
  res.json({ ok: true, note: 'Use /produtos-completos, /entidades-completas ou /estoque' });
});

module.exports = router;
