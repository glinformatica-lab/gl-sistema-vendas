require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v43.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v43 aplicada (módulo salão: profissionais + serviços + taxas).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
