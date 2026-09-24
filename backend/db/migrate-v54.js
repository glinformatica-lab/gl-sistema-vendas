require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v54.sql'), 'utf8');
    console.log('Aplicando migration v54 (sync bidirecional)...');
    await pool.query(sql);
    console.log('OK Migration v54 aplicada');
    console.log('  - sync_uuid + updated_at + triggers em produtos, clientes, fornecedores, vendas, ...');
    console.log('  - tabelas sync_state, sync_log, sync_tokens criadas');
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
})();
