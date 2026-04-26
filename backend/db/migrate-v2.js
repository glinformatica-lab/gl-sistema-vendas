// Roda a migration v2 (adiciona campos SaaS).
// Idempotente — pode rodar várias vezes.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v2.sql'), 'utf8');
    await db.query(sql);
    console.log('✓ Migration v2 aplicada com sucesso.');
    console.log('  Empresas existentes precisam ter status/plano definidos.');
    console.log('  Rode: npm run init-master para criar o usuário Master.');
    process.exit(0);
  } catch (err) {
    console.error('✗ Erro ao aplicar migration:', err.message);
    process.exit(1);
  }
})();
