// Migration v7: tabela reset_senha_tokens
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v7.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v7 aplicada com sucesso.');
    console.log('  Criada: tabela reset_senha_tokens.');
  } catch (e) {
    console.error('Erro ao aplicar migration v7:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
