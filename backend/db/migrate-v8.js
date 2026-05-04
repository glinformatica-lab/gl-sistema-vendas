// Migration v8: tabela master_acessos
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v8.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v8 aplicada com sucesso.');
    console.log('  Criada: tabela master_acessos.');
  } catch (e) {
    console.error('Erro ao aplicar migration v8:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
