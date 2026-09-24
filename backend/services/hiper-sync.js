// ============================================
// LÓGICA DE SINCRONIZAÇÃO — API HIPER
// Puxa produtos e estoque da nuvem Hiper e faz upsert no PostgreSQL do GL
// Usa hiper_map_produtos pra evitar duplicar
// ============================================
const db = require('../db');
const hiperClient = require('./hiper-client');

// Sincroniza produtos da empresa
async function syncProdutos(empresaId) {
  const inicio = Date.now();
  let criados = 0, atualizados = 0, erros = 0;

  const client = await db.pool.connect();
  try {
    // 1) Busca config
    const rConfig = await client.query(
      'SELECT chave_api, ponto_sync_produtos FROM hiper_config WHERE empresa_id=$1',
      [empresaId]
    );
    if (rConfig.rows.length === 0) throw new Error('Módulo INTEGRA HIPER não configurado');
    const { chave_api, ponto_sync_produtos } = rConfig.rows[0];
    if (!chave_api) throw new Error('Chave API Hiper não cadastrada');

    // 2) Chama API Hiper com ponto de sincronização (incremental)
    const resposta = await hiperClient.listarProdutos(empresaId, chave_api, ponto_sync_produtos || 0);
    const produtos = Array.isArray(resposta) ? resposta : (resposta.produtos || []);
    let novoPontoSync = ponto_sync_produtos || 0;

    // 3) Upsert cada produto
    for (const p of produtos) {
      try {
        // Atualiza ponto de sync
        if (p.pontoDeSincronizacao && p.pontoDeSincronizacao > novoPontoSync) {
          novoPontoSync = p.pontoDeSincronizacao;
        }

        // Ignora produtos marcados como "removido" (não devem ir pra loja virtual)
        if (p.removido === true) continue;

        await client.query('BEGIN');

        // Busca no mapa se já foi importado
        const rMap = await client.query(
          'SELECT produto_id FROM hiper_map_produtos WHERE empresa_id=$1 AND hiper_id=$2',
          [empresaId, p.id]
        );

        if (rMap.rows.length > 0 && rMap.rows[0].produto_id) {
          // ATUALIZA produto existente
          await client.query(
            `UPDATE produtos SET
               nome=$1, categoria=$2, preco_venda=$3, preco_custo=COALESCE(preco_custo, 0),
               estoque=$4, codigo_barras=$5, ncm=$6, marca=$7, unidade_tributavel=$8,
               foto_url=$9
             WHERE id=$10 AND empresa_id=$11`,
            [
              p.nome || '(sem nome)',
              p.categoria || null,
              Number(p.preco) || 0,
              Number(p.quantidadeEmEstoque) || 0,
              p.codigoDeBarras || null,
              p.ncm ? p.ncm.replace(/\D/g, '').slice(0, 8) : null,
              p.marca || null,
              p.unidade || null,
              p.imagem || null,
              rMap.rows[0].produto_id, empresaId
            ]
          );
          await client.query(
            'UPDATE hiper_map_produtos SET atualizado_em=NOW() WHERE empresa_id=$1 AND hiper_id=$2',
            [empresaId, p.id]
          );
          atualizados++;
        } else {
          // CRIA novo produto
          const ins = await client.query(
            `INSERT INTO produtos (
               empresa_id, codigo, nome, categoria, preco_custo, preco_venda,
               estoque, codigo_barras, ncm, marca, unidade_tributavel, foto_url
             ) VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
              empresaId,
              String(p.codigo || p.id).slice(0, 50),
              p.nome || '(sem nome)',
              p.categoria || null,
              Number(p.preco) || 0,
              Number(p.quantidadeEmEstoque) || 0,
              p.codigoDeBarras || null,
              p.ncm ? p.ncm.replace(/\D/g, '').slice(0, 8) : null,
              p.marca || null,
              p.unidade || null,
              p.imagem || null
            ]
          );
          await client.query(
            `INSERT INTO hiper_map_produtos (empresa_id, hiper_id, produto_id, hiper_codigo)
             VALUES ($1,$2,$3,$4)`,
            [empresaId, p.id, ins.rows[0].id, String(p.codigo || '')]
          );
          criados++;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[hiper-sync] erro produto ${p.id}: ${err.message}`);
        erros++;
      }
    }

    // 4) Atualiza último ponto de sincronização
    await client.query(
      `UPDATE hiper_config
       SET ultima_sync_produtos=NOW(), ponto_sync_produtos=$1
       WHERE empresa_id=$2`,
      [novoPontoSync, empresaId]
    );

    // 5) Grava log
    await client.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, qtd_criados, qtd_atualizados, qtd_erros, duracao_ms, mensagem)
       VALUES ($1,'produtos','api_hiper',$2,$3,$4,$5,$6,$7)`,
      [
        empresaId,
        erros === 0 ? 'ok' : (criados + atualizados > 0 ? 'parcial' : 'erro'),
        criados, atualizados, erros,
        Date.now() - inicio,
        `${produtos.length} recebidos, ${criados} criados, ${atualizados} atualizados, ${erros} erros`
      ]
    );

    return { ok: true, recebidos: produtos.length, criados, atualizados, erros };
  } catch (err) {
    // Grava log de erro
    await client.query(
      `INSERT INTO hiper_log_sync
       (empresa_id, tipo, fonte, status, qtd_erros, duracao_ms, mensagem)
       VALUES ($1,'produtos','api_hiper','erro',1,$2,$3)`,
      [empresaId, Date.now() - inicio, err.message]
    ).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { syncProdutos };
