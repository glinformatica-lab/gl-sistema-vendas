// Validação reCaptcha v3 - Google
// Recebe o token do frontend e valida com a API do Google
// Score >= 0.5 considera humano, < 0.5 considera robô

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;
const SCORE_MINIMO = 0.5; // Padrão recomendado pelo Google
const RECAPTCHA_OBRIGATORIO = String(process.env.RECAPTCHA_OBRIGATORIO || 'true').toLowerCase() !== 'false';

async function validarRecaptcha(token, ip) {
  // Se não houver chave configurada, não bloqueia (modo dev)
  if (!RECAPTCHA_SECRET) {
    console.warn('[recaptcha] RECAPTCHA_SECRET_KEY não configurada — pulando validação.');
    return { ok: true, motivo: 'sem-secret-key' };
  }
  if (!token) {
    return { ok: false, motivo: 'Token de verificação ausente. Recarregue a página e tente novamente.' };
  }
  try {
    const params = new URLSearchParams();
    params.append('secret', RECAPTCHA_SECRET);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await resp.json();
    if (!data.success) {
      console.warn('[recaptcha] Falhou:', data['error-codes']);
      return { ok: false, motivo: 'Verificação de segurança falhou. Recarregue a página e tente novamente.' };
    }
    if (typeof data.score === 'number' && data.score < SCORE_MINIMO) {
      console.warn('[recaptcha] Score baixo:', data.score, 'ação:', data.action);
      // Se RECAPTCHA_OBRIGATORIO=false (modo soft launch), só registra mas deixa passar
      if (!RECAPTCHA_OBRIGATORIO) {
        console.warn('[recaptcha] Permitindo passar (RECAPTCHA_OBRIGATORIO=false)');
        return { ok: true, score: data.score, soft: true };
      }
      return { ok: false, motivo: 'Suspeita de atividade automatizada. Tente novamente em alguns instantes.' };
    }
    return { ok: true, score: data.score, action: data.action };
  } catch (err) {
    console.error('[recaptcha] Erro de rede:', err.message);
    // Em caso de falha de rede, deixa passar (não bloqueia o cliente)
    return { ok: true, motivo: 'erro-rede-permitido' };
  }
}

module.exports = { validarRecaptcha };
