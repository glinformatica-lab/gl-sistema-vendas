// Migration v23: sistema de vendedores + rastreamento de indicações + comissões
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v23.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v23 aplicada (vendedores + comissões).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`SELECT COUNT(*) AS qtd FROM vendedores`);
    console.log(`\nVendedores cadastrados: ${r.rows[0].qtd}`);
  } catch (e) {}
  process.exit(0);
}
rodar();
