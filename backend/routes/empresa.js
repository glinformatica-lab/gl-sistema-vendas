// Rotas para o admin de cada empresa ler/editar os dados da própria empresa.
// Usado para configurações que aparecem nos recibos.
const express = require('express');
const db = require('../db');
const { exigirAdmin } = require('../middleware/auth');

const router = express.Router();

const camelizar = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
};
const formatarDataIso = (d) => {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10);
};

// Pegar dados da própria empresa (qualquer usuário logado pode ler)
router.get('/', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const e = r.rows[0];
    res.json({ ...camelizar(e), dataVencimento: formatarDataIso(e.data_vencimento) });
  } catch (err) {
    console.error('[empresa/get]', err);
    res.status(500).json({ error: 'Erro ao carregar empresa.' });
  }
});

// Atualizar dados da empresa (só admin)
// O admin pode editar: nome, cnpj, telefone, email, endereço, logo.
// NÃO pode editar: status, plano, data_vencimento (isso é controlado pelo Master).
router.put('/', exigirAdmin, async (req, res) => {
  const { nome, cnpj, telefone, email, cep, endereco, bairro, cidade, uf, logo } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
  // Limita logo a ~2MB em base64 para evitar pesar o banco
  if (logo && typeof logo === 'string' && logo.length > 2_700_000) {
    return res.status(400).json({ error: 'Logo muito grande. Use uma imagem com no máximo 2MB.' });
  }
  try {
    const r = await db.query(
      `UPDATE empresas SET
         nome = $1,
         cnpj = $2,
         telefone = $3,
         email = $4,
         cep = $5,
         endereco = $6,
         bairro = $7,
         cidade = $8,
         uf = $9,
         logo = $10
       WHERE id = $11 RETURNING *`,
      [nome.trim(), cnpj || null, telefone || null, email || null,
       cep || null, endereco || null, bairro || null, cidade || null, uf || null,
       logo || null, req.user.empresaId]
    );
    const e = r.rows[0];
    res.json({ ...camelizar(e), dataVencimento: formatarDataIso(e.data_vencimento) });
  } catch (err) {
    console.error('[empresa/update]', err);
    res.status(500).json({ error: 'Erro ao salvar empresa.' });
  }
});

// Histórico de pagamentos da própria empresa (qualquer usuário logado pode ver)
router.get('/pagamentos', async (req, res) => {
  try {
    // Tenta buscar da tabela pagamentos (criada pelo master) - se não existir, retorna array vazio
    const r = await db.query(
      `SELECT id, valor, data_pagamento, forma, observacao, criado_em
       FROM pagamentos
       WHERE empresa_id=$1
       ORDER BY data_pagamento DESC, id DESC`,
      [req.user.empresaId]
    ).catch(() => ({ rows: [] }));
    res.json(r.rows.map(p => ({
      id: p.id,
      valor: Number(p.valor) || 0,
      dataPagamento: formatarDataIso(p.data_pagamento),
      forma: p.forma,
      observacao: p.observacao,
      criadoEm: p.criado_em
    })));
  } catch (err) {
    console.error('[empresa/pagamentos]', err);
    res.json([]);
  }
});

module.exports = router;
