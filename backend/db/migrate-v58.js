require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  console.log('=== Migration v58 ===');
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v58.sql'), 'utf8');
    await pool.query(sql);
    const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='usuarios' AND column_name='departamento'");
    console.log('[check] departamento criado?', r.rowCount > 0 ? 'SIM' : 'NAO');
    process.exit(0);
  } catch (err) { console.error('ERRO:', err.message); process.exit(1); }
})();
