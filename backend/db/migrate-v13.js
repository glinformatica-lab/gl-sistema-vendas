// Migration v13: campos de cancelamento da venda
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v13.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v13 aplicada com sucesso (cancelamento de vendas).');
  } catch (e) {
    console.error('Erro ao aplicar migration v13:', e.message);
    process.exit(1);
  }
  try {
    const r = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='vendas' AND column_name IN ('status','cancelada_em','cancelada_por_id','cancelada_por_nome','motivo_cancelamento')
      ORDER BY column_name
    `);
    console.log('Colunas de cancelamento criadas:', r.rows.map(x => x.column_name).join(', '));
  } catch (e) {}
  process.exit(0);
}
rodar();
