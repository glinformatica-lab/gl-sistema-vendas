// Migration v10: avulsos viram serviços cadastrados
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function rodar() {
  // Antes: conta quantos avulsos existem
  try {
    const r = await db.query(`SELECT COUNT(*) AS total FROM orcamento_itens WHERE tipo='avulso'`);
    console.log(`Itens avulsos encontrados antes da migração: ${r.rows[0].total}`);
  } catch (e) {
    console.warn('Aviso ao contar avulsos:', e.message);
  }

  const sql = fs.readFileSync(path.join(__dirname, 'schema-v10.sql'), 'utf8');
  try {
    await db.query(sql);
    console.log('✓ Migration v10 aplicada com sucesso.');
  } catch (e) {
    console.error('Erro ao aplicar migration v10:', e.message);
    process.exit(1);
  }

  // Depois: conta quantos avulsos sobraram (deve ser 0)
  try {
    const r = await db.query(`SELECT COUNT(*) AS total FROM orcamento_itens WHERE tipo='avulso'`);
    console.log(`Itens avulsos remanescentes: ${r.rows[0].total} (esperado: 0)`);
    const rs = await db.query(`SELECT COUNT(*) AS total FROM servicos WHERE ativo=TRUE`);
    console.log(`Total de serviços cadastrados (ativos): ${rs.rows[0].total}`);
  } catch (e) {
    console.warn('Aviso ao verificar:', e.message);
  }
  process.exit(0);
}
rodar();
