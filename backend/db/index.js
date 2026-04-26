// Conexão com PostgreSQL — usa DATABASE_URL do .env (formato Render: postgres://user:pass@host/db)
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render exige SSL em produção
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[db] erro inesperado:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
