// Migration v11: módulo fiscal (Plano Pro)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v11.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v11 aplicada com sucesso (módulo fiscal).');
  } catch (e) {
    console.error('Erro ao aplicar migration v11:', e.message);
    process.exit(1);
  }

  // Verifica colunas criadas
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='empresas' AND column_name LIKE '%fiscal%'
      ORDER BY column_name
    `);
    console.log('Colunas fiscais criadas:', r.rows.map(x => x.column_name).join(', '));
  } catch (e) {
    console.warn('Aviso ao verificar:', e.message);
  }
  process.exit(0);
}
rodar();
