// Job que verifica trials expirados e envia e-mail
// Roda automaticamente em background (1x ao dia, ao iniciar e a cada 24h)
const db = require('../db');
const { enviarEmail } = require('./email');

const APP_URL = process.env.APP_URL || 'https://sistema.glinformatica.com.br';

async function verificarTrialsExpirados() {
  try {
    // Busca empresas em trial cujo vencimento já passou e que ainda não foram marcadas como expiradas
    const r = await db.query(
      `SELECT e.id, e.nome, e.data_vencimento,
              (SELECT u.email FROM usuarios u WHERE u.empresa_id = e.id AND u.papel = 'admin' ORDER BY u.id LIMIT 1) AS email_admin,
              (SELECT u.nome FROM usuarios u WHERE u.empresa_id = e.id AND u.papel = 'admin' ORDER BY u.id LIMIT 1) AS nome_admin
       FROM empresas e
       WHERE e.status = 'trial' AND e.data_vencimento < CURRENT_DATE`
    );
    if (r.rows.length === 0) {
      console.log('[job-trial] Nenhum trial expirado encontrado.');
      return;
    }
    console.log(`[job-trial] ${r.rows.length} trial(s) expirando agora...`);
    for (const emp of r.rows) {
      // Marca como expirada
      await db.query(`UPDATE empresas SET status = 'trial-expirado' WHERE id = $1`, [emp.id]);
      console.log(`[job-trial] Empresa ${emp.id} (${emp.nome}) marcada como trial-expirado.`);
      // Envia e-mail pro admin da empresa
      if (emp.email_admin) {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; font-size: 22px;">⏰ Seu período de teste expirou</h1>
            </div>
            <div style="background: #fff; border: 1px solid #ddd; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
              <p>Olá, <strong>${emp.nome_admin || 'parceiro'}</strong>!</p>
              <p>Os 7 dias gratuitos da empresa <strong>${emp.nome}</strong> chegaram ao fim.</p>
              <p><strong>O que muda agora?</strong></p>
              <ul style="line-height: 1.8;">
                <li>✅ Seus dados continuam <strong>seguros e preservados</strong></li>
                <li>✅ Você ainda pode <strong>visualizar</strong> tudo que cadastrou</li>
                <li>⚠️ Cadastros, vendas e edições ficam <strong>bloqueados</strong> até assinar um plano</li>
              </ul>
              <div style="background: #eef2ff; padding: 16px; border-radius: 8px; margin: 18px 0;">
                <strong>Continue aproveitando o sistema completo:</strong>
                <ul style="margin: 8px 0 0; padding-left: 20px;">
                  <li>📅 <strong>Plano Mensal:</strong> R$ 99,90/mês</li>
                  <li>🌟 <strong>Plano Anual:</strong> R$ 1.080,00 (R$ 90/mês — economize 10%)</li>
                </ul>
              </div>
              <div style="text-align: center; margin: 22px 0;">
                <a href="${APP_URL}/assinar" style="background: #1e3a8a; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Assinar Agora</a>
              </div>
              <p style="color: #666; font-size: 13px; text-align: center;">
                Dúvidas? Fale conosco no WhatsApp <a href="https://wa.me/5562992347572" style="color:#16a34a;">(62) 99234-7572</a>.
              </p>
            </div>
            <p style="text-align: center; color: #888; font-size: 11px; margin-top: 14px;">
              GL Sistema de Vendas — automação para o seu negócio.
            </p>
          </div>`;
        enviarEmail({
          para: emp.email_admin,
          assunto: `⏰ Seu teste do GL Sistema expirou — Continue por R$ 99,90/mês`,
          html
        }).catch(e => console.error('[job-trial] erro e-mail:', e.message));
      }
    }
  } catch (err) {
    console.error('[job-trial] Erro:', err.message);
  }
}

async function verificarLicencasVencidas() {
  try {
    const r = await db.query(
      `UPDATE empresas SET status = 'vencida'
       WHERE status = 'ativa' AND data_vencimento < CURRENT_DATE
       RETURNING id, nome`
    );
    if (r.rows.length > 0) {
      console.log(`[job-licenca] ${r.rows.length} licença(s) marcadas como vencidas.`);
    }
  } catch (err) {
    console.error('[job-licenca] Erro:', err.message);
  }
}

function iniciarJobs() {
  // Roda 30 segundos após inicialização
  setTimeout(() => {
    console.log('[jobs] Verificando expiração inicial...');
    verificarTrialsExpirados();
    verificarLicencasVencidas();
  }, 30 * 1000);
  // Depois roda a cada 24h
  setInterval(() => {
    console.log('[jobs] Verificação periódica...');
    verificarTrialsExpirados();
    verificarLicencasVencidas();
  }, 24 * 60 * 60 * 1000);
}

module.exports = { iniciarJobs, verificarTrialsExpirados, verificarLicencasVencidas };
