// Migration v12: campos fiscais nos produtos + certificado A1 + auditoria
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v12.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v12 aplicada com sucesso (campos fiscais).');
  } catch (e) {
    console.error('Erro ao aplicar migration v12:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='produtos' AND column_name IN ('ncm','cest','cfop_padrao','origem_mercadoria','csosn','cst','unidade_tributavel')
      ORDER BY column_name
    `);
    console.log('Colunas fiscais em produtos:', r.rows.map(x => x.column_name).join(', '));
  } catch (e) {}
  process.exit(0);
}
rodar();
