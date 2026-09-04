// ============================================
// CRÉDITOS DE DEVOLUÇÃO POR CLIENTE
// Feature: só módulo iluminação
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// Middleware: requer módulo iluminação ativo
async function requerAmbientes(req, res, next) {
  try {
    const r = await db.query('SELECT usa_ambientes FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.usa_ambientes) {
      return res.status(403).json({ error: 'Feature disponível apenas com Módulo Iluminação.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo: ' + e.message });
  }
}

router.use(requerAmbientes);

// ==========================================
// GET /cliente/:id — Saldo + histórico
// ==========================================
router.get('/cliente/:id', async (req, res) => {
  try {
    const cliId = parseInt(req.params.id);
    if (!Number.isInteger(cliId)) return res.status(400).json({ error: 'ID inválido.' });

    const rCli = await db.query(
      `SELECT id, nome, credito_saldo FROM clientes WHERE id=$1 AND empresa_id=$2`,
      [cliId, req.user.empresaId]
    );
    if (rCli.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const rHist = await db.query(
      `SELECT id, tipo, valor, origem_venda_id, destino_venda_id, motivo,
              saldo_apos, criado_em, criado_por_nome
       FROM creditos_cliente
       WHERE cliente_id=$1 AND empresa_id=$2
       ORDER BY criado_em DESC LIMIT 100`,
      [cliId, req.user.empresaId]
    );

    res.json({
      cliente: rCli.rows[0],
      saldo: Number(rCli.rows[0].credito_saldo) || 0,
      historico: rHist.rows
    });
  } catch (err) {
    console.error('[creditos] GET cliente', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST /lancar — Lança crédito MANUAL (exige senha admin)
// Body: { clienteId, valor, motivo, senhaAdmin }
// ==========================================
router.post('/lancar', async (req, res) => {
  const { clienteId, valor, motivo, senhaAdmin } = req.body || {};

  const cliId = parseInt(clienteId);
  const val = Number(valor);
  if (!Number.isInteger(cliId) || cliId <= 0) return res.status(400).json({ error: 'clienteId inválido.' });
  if (!(val > 0)) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'Motivo é obrigatório.' });
  if (!senhaAdmin) return res.status(400).json({ error: 'Senha do admin é obrigatória para lançar crédito manual.' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Valida senha admin: busca qualquer admin da empresa e testa a senha
    const rAdmins = await client.query(
      `SELECT id, nome, senha_hash FROM usuarios
       WHERE empresa_id=$1 AND papel='admin' AND (bloqueado IS NULL OR bloqueado=false)`,
      [req.user.empresaId]
    );
    let adminValido = null;
    for (const adm of rAdmins.rows) {
      const ok = await bcrypt.compare(senhaAdmin, adm.senha_hash);
      if (ok) { adminValido = adm; break; }
    }
    if (!adminValido) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Senha do admin inválida.' });
    }

    // Busca cliente com FOR UPDATE pra travar durante a transação
    const rCli = await client.query(
      `SELECT id, nome, credito_saldo FROM clientes
       WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
      [cliId, req.user.empresaId]
    );
    if (rCli.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const saldoAntes = Number(rCli.rows[0].credito_saldo) || 0;
    const saldoNovo = saldoAntes + val;

    await client.query(
      `INSERT INTO creditos_cliente
         (empresa_id, cliente_id, tipo, valor, motivo, saldo_apos,
          criado_por, criado_por_nome)
       VALUES ($1, $2, 'ajuste', $3, $4, $5, $6, $7)`,
      [req.user.empresaId, cliId, val, motivo.trim(), saldoNovo,
       req.user.userId, `${adminValido.nome} (autorizou)`]
    );

    await client.query(
      `UPDATE clientes SET credito_saldo=$1 WHERE id=$2`,
      [saldoNovo, cliId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, saldoAnterior: saldoAntes, saldoAtual: saldoNovo });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[creditos] POST lancar', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// FUNÇÕES HELPER (usadas por outras rotas)
// ==========================================

// Adiciona crédito ao cliente (chamada quando cancela venda paga)
// Retorna { saldoAntes, saldoDepois }
async function adicionarCredito(client, { empresaId, clienteId, valor, origemVendaId, motivo, criadoPor, criadoPorNome }) {
  const rCli = await client.query(
    `SELECT credito_saldo FROM clientes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
    [clienteId, empresaId]
  );
  if (rCli.rows.length === 0) throw new Error('Cliente não encontrado.');

  const saldoAntes = Number(rCli.rows[0].credito_saldo) || 0;
  const saldoDepois = saldoAntes + Number(valor);

  await client.query(
    `INSERT INTO creditos_cliente
       (empresa_id, cliente_id, tipo, valor, origem_venda_id, motivo, saldo_apos, criado_por, criado_por_nome)
     VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7, $8)`,
    [empresaId, clienteId, valor, origemVendaId, motivo, saldoDepois, criadoPor, criadoPorNome]
  );
  await client.query(
    `UPDATE clientes SET credito_saldo=$1 WHERE id=$2`,
    [saldoDepois, clienteId]
  );

  return { saldoAntes, saldoDepois };
}

// Usa crédito do cliente (chamada quando abate em venda nova)
async function usarCredito(client, { empresaId, clienteId, valor, destinoVendaId, criadoPor, criadoPorNome }) {
  const rCli = await client.query(
    `SELECT credito_saldo FROM clientes WHERE id=$1 AND empresa_id=$2 FOR UPDATE`,
    [clienteId, empresaId]
  );
  if (rCli.rows.length === 0) throw new Error('Cliente não encontrado.');

  const saldoAntes = Number(rCli.rows[0].credito_saldo) || 0;
  const val = Number(valor);
  if (val > saldoAntes) throw new Error(`Saldo insuficiente. Disponível: R$ ${saldoAntes.toFixed(2)}`);

  const saldoDepois = saldoAntes - val;

  await client.query(
    `INSERT INTO creditos_cliente
       (empresa_id, cliente_id, tipo, valor, destino_venda_id, motivo, saldo_apos, criado_por, criado_por_nome)
     VALUES ($1, $2, 'uso', $3, $4, $5, $6, $7, $8)`,
    [empresaId, clienteId, val, destinoVendaId, `Uso em venda #${destinoVendaId}`, saldoDepois, criadoPor, criadoPorNome]
  );
  await client.query(
    `UPDATE clientes SET credito_saldo=$1 WHERE id=$2`,
    [saldoDepois, clienteId]
  );

  return { saldoAntes, saldoDepois };
}

module.exports = router;
module.exports.adicionarCredito = adicionarCredito;
module.exports.usarCredito = usarCredito;
