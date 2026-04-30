// Serviço de envio de e-mail via Resend (API REST)
// Não usa biblioteca, faz fetch direto na API
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jose.neto@glinformatica.com.br';
// Por padrão usa o domínio de teste do Resend; quando você verificar o domínio,
// muda EMAIL_FROM no Render pra 'GL Sistema <noreply@glinformatica.com.br>'
const EMAIL_FROM = process.env.EMAIL_FROM || 'GL Sistema <onboarding@resend.dev>';

async function enviarEmail({ para, assunto, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY não configurada — pulando envio.');
    return { ok: false, motivo: 'RESEND_API_KEY ausente' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(para) ? para : [para],
        subject: assunto,
        html: html
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[email] Erro Resend:', resp.status, data);
      return { ok: false, motivo: data.message || 'Erro desconhecido' };
    }
    console.log('[email] ✓ Enviado para', para, '— id:', data.id);
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] Falha ao enviar:', err.message);
    return { ok: false, motivo: err.message };
  }
}

// Notifica o admin (você) quando uma nova venda/assinatura é paga
async function notificarVendaParaAdmin({ empresaNome, empresaCnpj, valorTotal, plano, emailCliente, telefoneCliente, referenceId }) {
  const dataFmt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const valorFmt = `R$ ${Number(valorTotal).toFixed(2).replace('.', ',')}`;
  const planoLabel = plano === 'mensal' ? 'Plano Mensal' : (plano === 'anual' ? 'Plano Anual' : plano);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #16a34a, #15803d); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 22px;">🎉 Nova venda no GL Sistema!</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.9;">${dataFmt}</p>
      </div>
      <div style="background: #fff; border: 1px solid #ddd; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px; border-radius: 6px; margin-bottom: 18px;">
          <strong style="color: #166534;">Pagamento aprovado e empresa ativada automaticamente.</strong>
        </div>
        <h2 style="color: #1e3a8a; font-size: 16px; margin-bottom: 8px;">Dados da venda</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #555;">Empresa:</td><td style="padding: 6px 0; font-weight: 600;">${empresaNome || '—'}</td></tr>
          <tr><td style="padding: 6px 0; color: #555;">CNPJ:</td><td style="padding: 6px 0;">${empresaCnpj || '—'}</td></tr>
          <tr><td style="padding: 6px 0; color: #555;">Plano:</td><td style="padding: 6px 0;">${planoLabel}</td></tr>
          <tr><td style="padding: 6px 0; color: #555;">Valor:</td><td style="padding: 6px 0; font-weight: 700; color: #16a34a; font-size: 18px;">${valorFmt}</td></tr>
          <tr><td style="padding: 6px 0; color: #555;">E-mail do cliente:</td><td style="padding: 6px 0;">${emailCliente || '—'}</td></tr>
          <tr><td style="padding: 6px 0; color: #555;">Telefone:</td><td style="padding: 6px 0;">${telefoneCliente || '—'}</td></tr>
          <tr><td style="padding: 6px 0; color: #555;">Referência:</td><td style="padding: 6px 0; font-family: monospace; font-size: 12px;">${referenceId || '—'}</td></tr>
        </table>
        <div style="margin-top: 22px; padding-top: 18px; border-top: 1px solid #eee; text-align: center;">
          <a href="https://sistema.glinformatica.com.br/master" style="background: #1e3a8a; color: white; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">Abrir Painel Master</a>
        </div>
      </div>
      <p style="text-align: center; color: #888; font-size: 11px; margin-top: 14px;">
        E-mail automático do GL Sistema de Vendas. Não responda este e-mail.
      </p>
    </div>
  `;
  return enviarEmail({
    para: ADMIN_EMAIL,
    assunto: `🎉 Nova venda: ${empresaNome} — ${valorFmt}`,
    html
  });
}

module.exports = { enviarEmail, notificarVendaParaAdmin };
