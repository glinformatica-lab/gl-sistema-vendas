// Migration v18: converter dados antigos pra MAIÚSCULA
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema-v18.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v18 aplicada (dados de texto convertidos pra MAIÚSCULA).');
  } catch (e) {
    console.error('Erro ao aplicar migration v18:', e.message);
    process.exit(1);
  }
  // Mostra alguns exemplos pra confirmar
  try {
    const r = await db.query(`SELECT nome FROM clientes WHERE nome IS NOT NULL LIMIT 5`);
    if (r.rows.length > 0) {
      console.log('\nExemplos de clientes convertidos:');
      r.rows.forEach(row => console.log('  •', row.nome));
    }
    const r2 = await db.query(`SELECT nome FROM produtos WHERE nome IS NOT NULL LIMIT 5`);
    if (r2.rows.length > 0) {
      console.log('\nExemplos de produtos convertidos:');
      r2.rows.forEach(row => console.log('  •', row.nome));
    }
  } catch (e) {}
  process.exit(0);
}
rodar();
