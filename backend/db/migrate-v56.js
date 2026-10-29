require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v56.sql'), 'utf8');
    console.log('Aplicando migration v56 (Modulo Laboratorio)...');
    await pool.query(sql);
    console.log('OK Migration v56 aplicada');
    process.exit(0);
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
})();
