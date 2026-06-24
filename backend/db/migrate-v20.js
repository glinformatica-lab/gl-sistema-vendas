// Migration v20: pedidos online
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v20.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v20 aplicada (pedidos online).');
  } catch (e) {
    console.error('Erro:', e.message);
    process.exit(1);
  }
  try {
    const r1 = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name='pedidos_online'`);
    console.log('Tabela pedidos_online:', r1.rows.length > 0 ? '✓' : '✗');
    const r2 = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name='pedidos_online_itens'`);
    console.log('Tabela pedidos_online_itens:', r2.rows.length > 0 ? '✓' : '✗');
  } catch (e) {}
  process.exit(0);
}
rodar();
