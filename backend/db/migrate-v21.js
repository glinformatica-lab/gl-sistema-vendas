// Migration v21: renomeação dos planos
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v21.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v21 aplicada (renomeação de planos).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`SELECT plano, COUNT(*) AS qtd FROM empresas GROUP BY plano ORDER BY plano`);
    console.log('\nDistribuição atual de planos:');
    r.rows.forEach(row => console.log(`  ${row.plano}: ${row.qtd} empresa(s)`));
  } catch (e) {}
  process.exit(0);
}
rodar();
