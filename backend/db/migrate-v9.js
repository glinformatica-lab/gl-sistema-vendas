// Migration v9: serviços e orçamentos
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v9.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v9 aplicada com sucesso.');
    console.log('  Criadas: servicos, orcamentos, orcamento_itens.');
    console.log('  Função: proximo_numero_orcamento.');
  } catch (e) {
    console.error('Erro ao aplicar migration v9:', e.message);
    process.exit(1);
  }
  process.exit(0);
}
rodar();
