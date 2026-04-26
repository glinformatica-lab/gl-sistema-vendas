// Roda o schema.sql para criar todas as tabelas. Idempotente — pode rodar várias vezes.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(sql);
    console.log('✓ Banco de dados inicializado com sucesso.');
    process.exit(0);
  } catch (err) {
    console.error('✗ Erro ao inicializar o banco:', err.message);
    process.exit(1);
  }
})();
