// Migration v6: tabelas de caixa diário
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v6.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v6 aplicada com sucesso.');
    console.log('  Criadas: tabelas caixas e caixa_movimentos.');
  } catch (e) {
    console.error('Erro ao aplicar migration v6:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
