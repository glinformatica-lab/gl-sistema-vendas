// ============================================
// AGENDAMENTOS DO SALÃO
// Feature: só módulo salão
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: requer módulo salão ativo
async function requerSalao(req, res, next) {
  try {
    const r = await db.query('SELECT modulo_salao FROM empresas WHERE id=$1', [req.user.empresaId]);
    if (!r.rows[0]?.modulo_salao) {
      return res.status(403).json({ error: 'Feature disponível apenas com Módulo Salão.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao verificar módulo: ' + e.message });
  }
}
router.use(requerSalao);

// Helper camelCase
function camelizar(row) {
  const out = {};
  for (const k in row) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    out[camel] = row[k];
  }
  return out;
}

// Helper: monta um objeto de agendamento pronto pro frontend
function montar(row) {
  const obj = camelizar(row);
  // Datas em ISO (YYYY-MM-DD)
  if (obj.data instanceof Date) obj.data = obj.data.toISOString().slice(0, 10);
  // Hora em HH:MM
  if (obj.horaInicio && typeof obj.horaInicio === 'string') {
    obj.horaInicio = obj.horaInicio.slice(0, 5);
  }
  return obj;
}

// ==========================================
// GET /hoje — Agendamentos de hoje (pro dashboard)
// ==========================================
router.get('/hoje', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.*, p.nome AS profissional_nome
       FROM agendamentos a
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.empresa_id = $1
         AND a.data = CURRENT_DATE
       ORDER BY a.hora_inicio`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(montar));
  } catch (err) {
    console.error('[agendamentos] GET /hoje', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET / — Lista agendamentos por período
// Query params: ?de=YYYY-MM-DD&ate=YYYY-MM-DD&profissionalId=X
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { de, ate, profissionalId } = req.query;
    const where = ['a.empresa_id = $1'];
    const vals = [req.user.empresaId];
    let idx = 2;

    if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) {
      where.push(`a.data >= $${idx++}`);
      vals.push(de);
    }
    if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) {
      where.push(`a.data <= $${idx++}`);
      vals.push(ate);
    }
    if (profissionalId && !isNaN(profissionalId)) {
      where.push(`a.profissional_id = $${idx++}`);
      vals.push(parseInt(profissionalId));
    }

    const r = await db.query(
      `SELECT a.*, p.nome AS profissional_nome
       FROM agendamentos a
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.data, a.hora_inicio`,
      vals
    );
    res.json(r.rows.map(montar));
  } catch (err) {
    console.error('[agendamentos] GET /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// GET /:id — Detalhe
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await db.query(
      `SELECT a.*, p.nome AS profissional_nome
       FROM agendamentos a
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.id = $1 AND a.empresa_id = $2`,
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json(montar(r.rows[0]));
  } catch (err) {
    console.error('[agendamentos] GET /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// POST / — Novo agendamento
// ==========================================
router.post('/', async (req, res) => {
  try {
    const {
      profissionalId, clienteId, clienteNome, clienteTelefone,
      data, horaInicio, duracaoMin,
      servicoId, servicoNome,
      observacoes
    } = req.body;

    // Validações básicas
    if (!profissionalId) return res.status(400).json({ error: 'Profissional é obrigatório.' });
    if (!clienteNome || !clienteNome.trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: 'Data inválida.' });
    if (!horaInicio || !/^\d{2}:\d{2}(:\d{2})?$/.test(horaInicio)) return res.status(400).json({ error: 'Hora de início inválida.' });

    // Se veio servicoId, busca o nome do serviço (snapshot)
    let nomeServ = servicoNome || null;
    if (servicoId && !nomeServ) {
      const s = await db.query('SELECT nome FROM servicos_salao WHERE id=$1 AND empresa_id=$2',
        [servicoId, req.user.empresaId]);
      if (s.rows[0]) nomeServ = s.rows[0].nome;
    }

    const r = await db.query(
      `INSERT INTO agendamentos
        (empresa_id, profissional_id, cliente_id, cliente_nome, cliente_telefone,
         data, hora_inicio, duracao_min, servico_id, servico_nome, observacoes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'agendado')
       RETURNING *`,
      [
        req.user.empresaId,
        parseInt(profissionalId),
        clienteId ? parseInt(clienteId) : null,
        clienteNome.trim(),
        clienteTelefone || null,
        data,
        horaInicio,
        parseInt(duracaoMin) || 60,
        servicoId ? parseInt(servicoId) : null,
        nomeServ,
        observacoes || null
      ]
    );
    res.status(201).json(montar(r.rows[0]));
  } catch (err) {
    console.error('[agendamentos] POST /', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// PUT /:id — Editar
// ==========================================
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

    const {
      profissionalId, clienteId, clienteNome, clienteTelefone,
      data, horaInicio, duracaoMin,
      servicoId, servicoNome,
      observacoes
    } = req.body;

    if (!profissionalId) return res.status(400).json({ error: 'Profissional é obrigatório.' });
    if (!clienteNome || !clienteNome.trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: 'Data inválida.' });
    if (!horaInicio || !/^\d{2}:\d{2}(:\d{2})?$/.test(horaInicio)) return res.status(400).json({ error: 'Hora inválida.' });

    let nomeServ = servicoNome || null;
    if (servicoId && !nomeServ) {
      const s = await db.query('SELECT nome FROM servicos_salao WHERE id=$1 AND empresa_id=$2',
        [servicoId, req.user.empresaId]);
      if (s.rows[0]) nomeServ = s.rows[0].nome;
    }

    const r = await db.query(
      `UPDATE agendamentos
         SET profissional_id=$1, cliente_id=$2, cliente_nome=$3, cliente_telefone=$4,
             data=$5, hora_inicio=$6, duracao_min=$7,
             servico_id=$8, servico_nome=$9, observacoes=$10, atualizado_em=NOW()
       WHERE id=$11 AND empresa_id=$12
       RETURNING *`,
      [
        parseInt(profissionalId),
        clienteId ? parseInt(clienteId) : null,
        clienteNome.trim(),
        clienteTelefone || null,
        data,
        horaInicio,
        parseInt(duracaoMin) || 60,
        servicoId ? parseInt(servicoId) : null,
        nomeServ,
        observacoes || null,
        id,
        req.user.empresaId
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json(montar(r.rows[0]));
  } catch (err) {
    console.error('[agendamentos] PUT /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// PUT /:id/status — Marcar como atendido ou cancelado
// ==========================================
router.put('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });

    const { status } = req.body;
    const validos = ['agendado', 'atendido', 'cancelado'];
    if (!validos.includes(status)) {
      return res.status(400).json({ error: 'Status inválido. Use: ' + validos.join(', ') });
    }

    const r = await db.query(
      `UPDATE agendamentos SET status=$1, atualizado_em=NOW()
       WHERE id=$2 AND empresa_id=$3 RETURNING *`,
      [status, id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json(montar(r.rows[0]));
  } catch (err) {
    console.error('[agendamentos] PUT /:id/status', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

// ==========================================
// DELETE /:id — Apagar de vez
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await db.query(
      'DELETE FROM agendamentos WHERE id=$1 AND empresa_id=$2 RETURNING id',
      [id, req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json({ ok: true, mensagem: 'Agendamento removido.' });
  } catch (err) {
    console.error('[agendamentos] DELETE /:id', err);
    res.status(500).json({ error: 'Erro: ' + err.message });
  }
});

module.exports = router;
