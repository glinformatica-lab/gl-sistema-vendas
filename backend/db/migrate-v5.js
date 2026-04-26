// Migration v5: adiciona origem e valor_mensal nas empresas
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v5.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v5 aplicada com sucesso.');
    console.log('  Adicionado: empresas.origem (auto-assinatura | manual).');
  } catch (e) {
    console.error('Erro ao aplicar migration v5:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
