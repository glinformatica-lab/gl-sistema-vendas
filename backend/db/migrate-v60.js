require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  console.log('=== Migration v60 ===');
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v60.sql'), 'utf8');
    await pool.query(sql);
    const r = await pool.query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='assinaturas_plano_check'");
    console.log('[check]', r.rows.length > 0 ? r.rows[0].def : 'nao achado');
    process.exit(0);
  } catch (err) { console.error('ERRO:', err.message); process.exit(1); }
})();
