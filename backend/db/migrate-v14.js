// Migration v14: grupo_id em usuarios (multi-empresa)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v14.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v14 aplicada com sucesso (multi-empresa).');
  } catch (e) {
    console.error('Erro ao aplicar migration v14:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='usuarios' AND column_name='grupo_id'
    `);
    console.log('Coluna grupo_id criada:', r.rows.length > 0 ? '✓' : '✗');
  } catch (e) {}
  process.exit(0);
}
rodar();
