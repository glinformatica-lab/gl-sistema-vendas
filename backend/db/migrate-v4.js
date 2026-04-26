// Roda a migration v4 (tabela de assinaturas).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v4.sql'), 'utf8');
    await db.query(sql);
    console.log('✓ Migration v4 aplicada com sucesso.');
    console.log('  Criada tabela "assinaturas" para fluxo de pagamento.');
    process.exit(0);
  } catch (err) {
    console.error('✗ Erro ao aplicar migration:', err.message);
    process.exit(1);
  }
})();
