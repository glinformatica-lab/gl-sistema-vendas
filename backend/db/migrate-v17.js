// Migration v17: foto_url em produtos
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v17.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v17 aplicada (coluna foto_url adicionada em produtos).');
  } catch (e) {
    console.error('Erro ao aplicar migration v17:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='produtos' AND column_name='foto_url'
    `);
    console.log('Coluna foto_url existe:', r.rows.length > 0 ? '✓' : '✗');
  } catch (e) {}
  process.exit(0);
}
rodar();
