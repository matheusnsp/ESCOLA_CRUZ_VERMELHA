// Envio de e-mail. Em producao usa o Resend; em desenvolvimento (sem
// RESEND_API_KEY configurada) apenas imprime o link no console, para voce
// conseguir testar sem precisar de dominio verificado.

const TEM_RESEND = !!process.env.RESEND_API_KEY;

let resend = null;
if (TEM_RESEND) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}

const REMETENTE = process.env.EMAIL_REMETENTE || 'Cruz Vermelha <no-reply@cruzvermelha-rj.org.br>';

function moldura(titulo, nome, texto, botaoLabel, link, rodape) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#cc0000;margin-bottom:8px;">Cruz Vermelha</h2>
      <h3 style="margin-bottom:16px;">${titulo}</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>${texto}</p>
      <a href="${link}" style="display:inline-block;margin:24px 0;background:#cc0000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;">
        ${botaoLabel}
      </a>
      <p style="color:#718096;font-size:13px;">${rodape}</p>
    </div>
  `;
}

async function enviar(email, subject, html, descricaoDev, link) {
  if (!resend) {
    console.log(`\n[DEV] ${descricaoDev} (RESEND_API_KEY ausente, e-mail nao enviado).`);
    console.log(`[DEV] Link/codigo para ${email}:\n${link}\n`);
    return;
  }
  // O SDK do Resend NAO lanca excecao em erro de API: ele retorna { data, error }.
  // Precisamos checar o `error` explicitamente.
  let resposta;
  try {
    resposta = await resend.emails.send({ from: REMETENTE, to: email, subject, html });
  } catch (e) {
    console.error(`[EMAIL] Erro de rede ao enviar para ${email}:`, e.message);
    if (link) console.log(`[DEV] Link/codigo de fallback para ${email}:\n${link}\n`);
    return;
  }
  if (resposta && resposta.error) {
    console.error(`[EMAIL] Resend recusou o envio para ${email}: ${resposta.error.message || JSON.stringify(resposta.error)}`);
    console.error('[EMAIL] Causa provavel: o remetente "onboarding@resend.dev" so entrega para o e-mail dono da conta Resend.');
    console.error('[EMAIL] Para enviar a QUALQUER destinatario (alunos), verifique um dominio no Resend e use um remetente desse dominio em EMAIL_REMETENTE.');
    if (link) console.log(`[DEV] Link/codigo de fallback para ${email}:\n${link}\n`);
    return;
  }
  return resposta && resposta.data;
}

async function enviarEmailResetSenha(email, nome, link) {
  const html = moldura(
    'Redefinição de senha',
    nome,
    'Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo:',
    'Redefinir minha senha',
    link,
    'O link expira em 1 hora. Se você não solicitou, ignore este e-mail.'
  );
  await enviar(email, 'Redefinição de senha — Escola de Capacitação', html, 'Link de redefinição de senha', link);
}

async function enviarEmailConfirmacao(email, nome, link) {
  const html = moldura(
    'Confirme seu e-mail',
    nome,
    'Falta só um passo para ativar sua conta na Escola de Capacitação. Confirme seu e-mail clicando abaixo:',
    'Confirmar meu e-mail',
    link,
    'O link expira em 24 horas. Se não foi você quem criou esta conta, ignore este e-mail.'
  );
  await enviar(email, 'Confirme seu e-mail — Escola de Capacitação', html, 'Link de confirmação de e-mail', link);
}

async function enviarCodigo2fa(email, nome, codigo) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#cc0000;margin-bottom:8px;">Cruz Vermelha</h2>
      <h3 style="margin-bottom:16px;">Código de acesso à secretaria</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Use o código abaixo para concluir o login no painel da secretaria:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#0b1220;background:#f5f6f9;border:1px solid #e7ebf2;border-radius:12px;padding:18px 0;text-align:center;margin:22px 0;">${codigo}</div>
      <p style="color:#718096;font-size:13px;">O código expira em 10 minutos. Se não foi você que tentou entrar, troque sua senha imediatamente.</p>
    </div>`;
  await enviar(email, 'Seu código de acesso — Secretaria CVB-RJ', html, `Código 2FA da secretaria: ${codigo}`, '(código no corpo do e-mail)');
}

async function enviarAlertaLoginSecretaria(email, nome, quando, ip) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#cc0000;margin-bottom:8px;">Cruz Vermelha</h2>
      <h3 style="margin-bottom:16px;">Novo acesso ao painel da secretaria</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Registramos um login no painel da secretaria:</p>
      <p style="background:#f5f6f9;border:1px solid #e7ebf2;border-radius:10px;padding:14px 16px;">
        <strong>Quando:</strong> ${quando}<br>
        <strong>Origem (IP):</strong> ${ip || 'desconhecido'}
      </p>
      <p style="color:#718096;font-size:13px;">Se foi você, pode ignorar este aviso. Se não reconhece este acesso, troque sua senha imediatamente.</p>
    </div>`;
  await enviar(email, 'Alerta de acesso — Secretaria CVB-RJ', html, `Alerta de login da secretaria (${quando}, IP ${ip || '?'})`, '(aviso de segurança)');
}

async function enviarLinkDesbloqueio(email, nome, link) {
  const html = moldura(
    'Desbloqueio de acesso à secretaria',
    nome,
    'A conta da secretaria foi bloqueada por segurança após várias tentativas de login. Se foi você, clique no botão abaixo para liberar o acesso:',
    'Liberar meu acesso',
    link,
    'O link expira em 1 hora e só pode ser usado uma vez. Se NÃO foi você, ignore este e-mail e troque a senha por precaução.'
  );
  await enviar(email, 'Desbloqueio de acesso — Secretaria CVB-RJ', html, 'Link de desbloqueio da secretaria', link);
}

module.exports = { enviarEmailResetSenha, enviarEmailConfirmacao, enviarCodigo2fa, enviarAlertaLoginSecretaria, enviarLinkDesbloqueio };
