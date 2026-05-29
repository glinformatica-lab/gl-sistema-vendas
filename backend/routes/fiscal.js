// routes/fiscal.js
// Configurações fiscais da empresa (Plano Pro)
// Todas as rotas exigem modulo_fiscal_ativo = true E papel = admin

const express = require('express');
const router = express.Router();
const db = require('../db');
const { criptografar, validarChaveConfigurada } = require('../services/cripto');

// Middleware: verifica se a empresa tem o módulo fiscal ativo
async function exigirModuloFiscal(req, res, next) {
  try {
    const r = await db.query(
      'SELECT modulo_fiscal_ativo FROM empresas WHERE id=$1',
      [req.user.empresaId]
    );
    if (!r.rows[0] || !r.rows[0].modulo_fiscal_ativo) {
      return res.status(403).json({
        error: 'Plano Pro necessário. Entre em contato pra ativar o Módulo Fiscal.',
        codigo: 'MODULO_FISCAL_INATIVO'
      });
    }
    next();
  } catch (err) {
    console.error('[fiscal/exigirModulo]', err);
    res.status(500).json({ error: 'Erro ao verificar módulo fiscal.' });
  }
}

function exigirAdmin(req, res, next) {
  if (req.user.papel !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem alterar configurações fiscais.' });
  }
  next();
}

router.use(exigirModuloFiscal);

router.get('/empresa', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT regime_tributario, inscricao_estadual, cnae_principal,
              cfop_padrao_vista, cfop_padrao_prazo, origem_mercadoria_padrao, csosn_padrao,
              certificado_a1_nome, certificado_a1_validade,
              CASE WHEN certificado_a1_conteudo IS NOT NULL THEN true ELSE false END AS tem_certificado
       FROM empresas WHERE id=$1`,
      [req.user.empresaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const e = r.rows[0];
    res.json({
      regimeTributario: e.regime_tributario,
      inscricaoEstadual: e.inscricao_estadual,
      cnaePrincipal: e.cnae_principal,
      cfopPadraoVista: e.cfop_padrao_vista,
      cfopPadraoPrazo: e.cfop_padrao_prazo,
      origemMercadoriaPadrao: e.origem_mercadoria_padrao,
      csosnPadrao: e.csosn_padrao,
      certificadoA1Nome: e.certificado_a1_nome,
      certificadoA1Validade: e.certificado_a1_validade,
      temCertificado: e.tem_certificado
    });
  } catch (err) {
    console.error('[fiscal/get-empresa]', err);
    res.status(500).json({ error: 'Erro ao carregar dados fiscais.' });
  }
});

router.put('/empresa', exigirAdmin, async (req, res) => {
  const {
    regimeTributario, inscricaoEstadual, cnaePrincipal,
    cfopPadraoVista, cfopPadraoPrazo, origemMercadoriaPadrao, csosnPadrao
  } = req.body || {};
  const regimes = ['mei', 'simples', 'presumido', 'real'];
  if (regimeTributario && !regimes.includes(regimeTributario)) {
    return res.status(400).json({ error: 'Regime tributário inválido.' });
  }
  if (cfopPadraoVista && !/^\d{4}$/.test(cfopPadraoVista)) {
    return res.status(400).json({ error: 'CFOP padrão (à vista) deve ter 4 dígitos.' });
  }
  if (cfopPadraoPrazo && !/^\d{4}$/.test(cfopPadraoPrazo)) {
    return res.status(400).json({ error: 'CFOP padrão (a prazo) deve ter 4 dígitos.' });
  }
  try {
    await db.query(
      `UPDATE empresas SET
         regime_tributario=$1, inscricao_estadual=$2, cnae_principal=$3,
         cfop_padrao_vista=$4, cfop_padrao_prazo=$5,
         origem_mercadoria_padrao=$6, csosn_padrao=$7
       WHERE id=$8`,
      [
        regimeTributario || null,
        inscricaoEstadual || null,
        cnaePrincipal || null,
        cfopPadraoVista || null,
        cfopPadraoPrazo || null,
        origemMercadoriaPadrao || '0',
        csosnPadrao || null,
        req.user.empresaId
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[fiscal/put-empresa]', err);
    res.status(500).json({ error: 'Erro ao salvar dados fiscais.' });
  }
});

router.post('/certificado', exigirAdmin, async (req, res) => {
  if (!validarChaveConfigurada()) {
    return res.status(500).json({
      error: 'Sistema sem chave de criptografia configurada. Contate o suporte.',
      codigo: 'CRYPT_KEY_MISSING'
    });
  }
  const { conteudoBase64, senha, nomeArquivo, validade } = req.body || {};
  if (!conteudoBase64 || !senha) {
    return res.status(400).json({ error: 'Arquivo do certificado e senha são obrigatórios.' });
  }
  if (conteudoBase64.length > 200000) {
    return res.status(400).json({ error: 'Arquivo muito grande. Certificados A1 têm em média 5-20KB.' });
  }
  if (senha.length > 200) {
    return res.status(400).json({ error: 'Senha muito longa.' });
  }
  try {
    const senhaCripto = criptografar(senha);
    await db.query(
      `UPDATE empresas SET
         certificado_a1_conteudo=$1,
         certificado_a1_senha_cripto=$2,
         certificado_a1_nome=$3,
         certificado_a1_validade=$4
       WHERE id=$5`,
      [conteudoBase64, senhaCripto, nomeArquivo || 'certificado.pfx', validade || null, req.user.empresaId]
    );
    await db.query(
      `INSERT INTO auditoria_certificado (empresa_id, usuario_id, acao, ip, user_agent)
       VALUES ($1, $2, 'upload', $3, $4)`,
      [req.user.empresaId, req.user.userId, req.ip, req.headers['user-agent'] || null]
    ).catch(() => {});
    res.json({ ok: true, nomeArquivo: nomeArquivo || 'certificado.pfx', validade });
  } catch (err) {
    console.error('[fiscal/upload-cert]', err);
    res.status(500).json({ error: 'Erro ao salvar certificado: ' + err.message });
  }
});

router.delete('/certificado', exigirAdmin, async (req, res) => {
  try {
    await db.query(
      `UPDATE empresas SET
         certificado_a1_conteudo=NULL,
         certificado_a1_senha_cripto=NULL,
         certificado_a1_nome=NULL,
         certificado_a1_validade=NULL
       WHERE id=$1`,
      [req.user.empresaId]
    );
    await db.query(
      `INSERT INTO auditoria_certificado (empresa_id, usuario_id, acao, ip, user_agent)
       VALUES ($1, $2, 'remove', $3, $4)`,
      [req.user.empresaId, req.user.userId, req.ip, req.headers['user-agent'] || null]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[fiscal/del-cert]', err);
    res.status(500).json({ error: 'Erro ao remover certificado.' });
  }
});

router.get('/auditoria-certificado', exigirAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.acao, a.ip, a.criado_em, u.nome AS usuario_nome
       FROM auditoria_certificado a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.empresa_id=$1
       ORDER BY a.criado_em DESC LIMIT 20`,
      [req.user.empresaId]
    );
    res.json(r.rows.map(x => ({
      acao: x.acao,
      ip: x.ip,
      criadoEm: x.criado_em,
      usuarioNome: x.usuario_nome
    })));
  } catch (err) {
    console.error('[fiscal/auditoria]', err);
    res.status(500).json({ error: 'Erro ao carregar auditoria.' });
  }
});

module.exports = router;
