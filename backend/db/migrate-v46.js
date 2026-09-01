require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v46.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v46 aplicada (módulo salão: vales + fechamentos).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
