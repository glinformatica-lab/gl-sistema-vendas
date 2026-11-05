require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  console.log('=== Migration v57 ===');
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema-v57.sql'), 'utf8');
    await pool.query(sql);
    console.log('[ok] Migration aplicada.');
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'lab_saidas_estoque'
         AND column_name IN ('estornado_em', 'estornado_por_usuario_id')`
    );
    console.log('[check] Colunas:', r.rows.map(x => x.column_name).join(', '));
    process.exit(0);
  } catch (err) {
    console.error('ERRO:', err.message);
    process.exit(1);
  }
})();
