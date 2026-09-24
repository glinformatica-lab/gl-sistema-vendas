require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v50.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v50 aplicada (renomeia preco_venda_nao_fiscal → preco_hiper).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
