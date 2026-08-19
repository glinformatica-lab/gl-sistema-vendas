// ============================================
// USO DO SISTEMA (Master)
// Métricas de armazenamento: PostgreSQL + Cloudinary + contadores por empresa
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const https = require('https');

// Middleware master já é aplicado no server.js (usa autenticarMaster + req.master)

// Helper: chama API do Cloudinary (usage endpoint)
// Docs: https://cloudinary.com/documentation/admin_api#usage
function cloudinaryUsage() {
  return new Promise((resolve, reject) => {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    const key = process.env.CLOUDINARY_API_KEY;
    const secret = process.env.CLOUDINARY_API_SECRET;

    if (!cloud || !key || !secret) {
      return resolve({ configurado: false });
    }

    const auth = Buffer.from(`${key}:${secret}`).toString('base64');
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloud}/usage`,
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            return resolve({ configurado: true, erro: json.error?.message || 'Erro ao consultar API' });
          }
          resolve({
            configurado: true,
            storage: {
              usadoBytes: json.storage?.usage || 0,
              limiteBytes: json.storage?.limit || 0,
              usadoMB: Math.round((json.storage?.usage || 0) / 1024 / 1024),
              limiteMB: Math.round((json.storage?.limit || 0) / 1024 / 1024),
            },
            bandwidth: {
              usadoBytes: json.bandwidth?.usage || 0,
              limiteBytes: json.bandwidth?.limit || 0,
              usadoMB: Math.round((json.bandwidth?.usage || 0) / 1024 / 1024),
              limiteMB: Math.round((json.bandwidth?.limit || 0) / 1024 / 1024),
            },
            transformations: {
              usadas: json.transformations?.usage || 0,
              limite: json.transformations?.limit || 0
            },
            totalRecursos: json.resources || 0,
            totalDerivados: json.derived_resources || 0,
            plano: json.plan || '—',
            atualizadoEm: json.last_updated || null
          });
        } catch (e) {
          resolve({ configurado: true, erro: 'Resposta inválida do Cloudinary' });
        }
      });
    });
    req.on('error', (err) => resolve({ configurado: true, erro: err.message }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ configurado: true, erro: 'Timeout ao consultar Cloudinary' });
    });
    req.end();
  });
}

// GET /api/master/uso-sistema
router.get('/', async (req, res) => {
  try {
    // ===== BANCO POSTGRESQL =====
    const rTamTotal = await db.query(`SELECT pg_database_size(current_database()) AS bytes`);
    const bancoBytes = parseInt(rTamTotal.rows[0].bytes) || 0;

    // Top tabelas por tamanho
    const rTopTabelas = await db.query(`
      SELECT
        t.table_name AS nome,
        pg_total_relation_size('"' || t.table_name || '"') AS bytes
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY pg_total_relation_size('"' || t.table_name || '"') DESC
      LIMIT 15
    `);
    const topTabelas = rTopTabelas.rows.map(r => ({
      nome: r.nome,
      bytes: parseInt(r.bytes) || 0,
      mb: Math.round((parseInt(r.bytes) || 0) / 1024 / 1024 * 100) / 100
    }));

    // ===== CONTADORES POR EMPRESA =====
    // Verifica quais tabelas existem antes de query (defensivo)
    const rCols = await db.query(
      `SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'empresa_id'`
    );
    const tabelasComEmpresa = new Set(rCols.rows.map(r => r.table_name));

    // Empresas com contadores em batch
    const rEmpresas = await db.query(`
      SELECT
        e.id, e.nome, e.plano, e.usa_ambientes,
        COALESCE((SELECT COUNT(*) FROM produtos WHERE empresa_id=e.id), 0)::int      AS total_produtos,
        COALESCE((SELECT COUNT(*) FROM produtos WHERE empresa_id=e.id AND foto_url IS NOT NULL), 0)::int AS total_fotos,
        COALESCE((SELECT COUNT(*) FROM clientes WHERE empresa_id=e.id), 0)::int      AS total_clientes,
        COALESCE((SELECT COUNT(*) FROM fornecedores WHERE empresa_id=e.id), 0)::int  AS total_fornecedores,
        COALESCE((SELECT COUNT(*) FROM orcamentos WHERE empresa_id=e.id), 0)::int    AS total_orcamentos,
        COALESCE((SELECT COUNT(*) FROM vendas WHERE empresa_id=e.id), 0)::int        AS total_vendas,
        COALESCE((SELECT COUNT(*) FROM usuarios WHERE empresa_id=e.id), 0)::int      AS total_usuarios
      FROM empresas e
      ORDER BY total_produtos DESC, e.nome
    `);
    const empresas = rEmpresas.rows.map(e => ({
      id: e.id,
      nome: e.nome,
      plano: e.plano,
      usaAmbientes: e.usa_ambientes,
      totalProdutos: e.total_produtos,
      totalFotos: e.total_fotos,
      totalClientes: e.total_clientes,
      totalFornecedores: e.total_fornecedores,
      totalOrcamentos: e.total_orcamentos,
      totalVendas: e.total_vendas,
      totalUsuarios: e.total_usuarios
    }));

    // ===== TOTAIS GLOBAIS =====
    const totais = empresas.reduce((acc, e) => {
      acc.produtos += e.totalProdutos;
      acc.fotos += e.totalFotos;
      acc.clientes += e.totalClientes;
      acc.fornecedores += e.totalFornecedores;
      acc.orcamentos += e.totalOrcamentos;
      acc.vendas += e.totalVendas;
      acc.usuarios += e.totalUsuarios;
      return acc;
    }, { produtos: 0, fotos: 0, clientes: 0, fornecedores: 0, orcamentos: 0, vendas: 0, usuarios: 0 });

    // ===== CLOUDINARY =====
    const cloudinary = await cloudinaryUsage();

    res.json({
      banco: {
        bytes: bancoBytes,
        mb: Math.round(bancoBytes / 1024 / 1024 * 100) / 100,
        gb: Math.round(bancoBytes / 1024 / 1024 / 1024 * 100) / 100,
        topTabelas
      },
      totais,
      totalEmpresas: empresas.length,
      empresas,
      cloudinary,
      geradoEm: new Date().toISOString()
    });
  } catch (err) {
    console.error('[uso-sistema] GET', err);
    res.status(500).json({ error: 'Erro ao consultar uso do sistema: ' + err.message });
  }
});

module.exports = router;
