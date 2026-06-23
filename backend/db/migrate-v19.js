// Migration v19: catálogo público com curadoria
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v19.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v19 aplicada (catálogo público com curadoria).');
  } catch (e) {
    console.error('Erro ao aplicar migration v19:', e.message);
    process.exit(1);
  }
  try {
    const r1 = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='empresas' AND column_name='catalogo_slug'`);
    console.log('Coluna catalogo_slug em empresas:', r1.rows.length > 0 ? '✓' : '✗');
    const r2 = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name='catalogo_config'`);
    console.log('Tabela catalogo_config:', r2.rows.length > 0 ? '✓' : '✗');
    const r3 = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name='catalogo_itens'`);
    console.log('Tabela catalogo_itens:', r3.rows.length > 0 ? '✓' : '✗');
  } catch (e) {}
  process.exit(0);
}
rodar();
