// Migration v15: suporte a empresa-extra
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v15.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v15 aplicada (empresa-extra na tabela assinaturas).');
  } catch (e) {
    console.error('Erro ao aplicar migration v15:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='assinaturas' AND column_name='metadata'
    `);
    console.log('Coluna metadata criada:', r.rows.length > 0 ? '✓' : '✗');
  } catch (e) {}
  process.exit(0);
}
rodar();
