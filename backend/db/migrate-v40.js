require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v40.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v40 aplicada (previsao_entrega em ordens_compra).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
