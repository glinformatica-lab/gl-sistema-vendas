// Roda a migration v3 (dados completos da empresa para recibos).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v3.sql'), 'utf8');
    await db.query(sql);
    console.log('✓ Migration v3 aplicada com sucesso.');
    console.log('  Adicionados campos: telefone, email, cep, endereco, bairro, cidade, uf, logo.');
    process.exit(0);
  } catch (err) {
    console.error('✗ Erro ao aplicar migration:', err.message);
    process.exit(1);
  }
})();
