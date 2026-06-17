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
    console.log(`[DEV] Link para ${email}:\n${link}\n`);
    return;
  }
  await resend.emails.send({ from: REMETENTE, to: email, subject, html });
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

module.exports = { enviarEmailResetSenha, enviarEmailConfirmacao };
