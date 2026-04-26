// Cria o primeiro usuário Master do sistema.
// Se já existir master, perguntar se quer adicionar outro.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const readline = require('readline');
const db = require('./index');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, ans => r(ans)));
const askPwd = async (q) => {
  // simplificado: lê normalmente (Windows não tem stty disponível em todos os terminais)
  return await ask(q);
};

(async () => {
  try {
    const r = await db.query('SELECT COUNT(*) AS n FROM master_usuarios');
    const n = Number(r.rows[0].n);
    if (n > 0) {
      console.log(`Já existem ${n} usuário(s) Master cadastrado(s).`);
      const cont = await ask('Adicionar outro Master? (s/N): ');
      if (cont.toLowerCase() !== 's') { rl.close(); process.exit(0); }
    }

    console.log('\n=== Criar usuário Master ===');
    const nome  = (await ask('Nome: ')).trim();
    const email = (await ask('E-mail: ')).trim().toLowerCase();
    const senha = await askPwd('Senha (mín. 6 caracteres): ');

    if (!nome) throw new Error('Nome é obrigatório.');
    if (!email || !email.includes('@')) throw new Error('E-mail inválido.');
    if (!senha || senha.length < 6) throw new Error('Senha deve ter pelo menos 6 caracteres.');

    const hash = await bcrypt.hash(senha, 10);
    await db.query(
      `INSERT INTO master_usuarios (nome, email, senha_hash) VALUES ($1, $2, $3)`,
      [nome, email, hash]
    );

    console.log(`\n✓ Master "${nome}" criado com sucesso!`);
    console.log(`  E-mail de login: ${email}`);
    console.log(`  Acesse o painel Master em: /master.html`);
    rl.close();
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Erro:', err.message);
    rl.close();
    process.exit(1);
  }
})();
