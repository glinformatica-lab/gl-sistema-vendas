// ============================================
// Gera token de sync pra uma empresa
// Rode: node gerar-sync-token.js <empresa_id> [descricao]
// ============================================
require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('./index');

const empresaId = parseInt(process.argv[2]);
const descricao = process.argv[3] || `Token gerado em ${new Date().toISOString()}`;

if (!empresaId) {
  console.error('Uso: node gerar-sync-token.js <empresa_id> [descricao]');
  process.exit(1);
}

(async () => {
  try {
    const r = await pool.query('SELECT id, nome FROM empresas WHERE id = $1', [empresaId]);
    if (!r.rowCount) {
      console.error(`Empresa ${empresaId} nao existe`);
      process.exit(2);
    }
    const empresa = r.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sync_tokens (empresa_id, token, descricao) VALUES ($1, $2, $3)`,
      [empresaId, token, descricao]
    );
    console.log('');
    console.log('===================================================');
    console.log(`  Token de sync gerado para: ${empresa.nome}`);
    console.log('===================================================');
    console.log('');
    console.log(`  Empresa ID: ${empresaId}`);
    console.log(`  Token:      ${token}`);
    console.log('');
    console.log('  Configure no .env do GL Sync Service:');
    console.log(`    EMPRESA_ID=${empresaId}`);
    console.log(`    SYNC_TOKEN=${token}`);
    console.log('');
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
})();
