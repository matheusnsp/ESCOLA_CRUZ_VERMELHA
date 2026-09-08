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

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — Espelho no terminal.
//
// Antes, o link/código só aparecia no console quando o Resend NÃO estava
// configurado. Com a chave configurada em desenvolvimento, você mandava o
// e-mail e ficava no escuro: pra pegar o código 2FA ou testar um link de
// lembrete era preciso abrir a caixa de entrada.
//
// Agora todo envio é espelhado no terminal, ANTES da tentativa de entrega —
// assim o dado aparece mesmo se o Resend recusar depois.
//
// ⚠️ SEGURANÇA: código 2FA e link de redefinição de senha são credenciais.
// Impressos em produção, ficariam gravados no log do Render, ao alcance de
// qualquer pessoa com acesso ao painel. Por isso o espelho completo só sai
// fora de produção — ou quando você liga EMAIL_DEBUG=1 de propósito, ciente
// disso. Em produção sem a flag, fica só uma linha dizendo o que foi enviado
// e pra quem, sem o conteúdo sensível.
// ─────────────────────────────────────────────────────────────────────────
const EMAIL_DEBUG = process.env.EMAIL_DEBUG === '1'
  || process.env.NODE_ENV !== 'production';

function espelharNoTerminal(email, subject, descricaoDev, link) {
  if (!EMAIL_DEBUG) {
    // Produção sem flag: rastro mínimo, sem credencial.
    console.log(`[EMAIL] "${subject}" -> ${email}`);
    return;
  }

  const barra = '-'.repeat(64);
  console.log(`\n+${barra}`);
  console.log(`| [EMAIL] ${descricaoDev}`);
  console.log(`| Para:    ${email}`);
  console.log(`| Assunto: ${subject}`);
  console.log(`| Entrega: ${resend ? 'via Resend' : 'DESLIGADA (sem RESEND_API_KEY)'}`);
  if (link) {
    console.log(`|${barra}`);
    console.log(`| ${link}`);
  }
  console.log(`+${barra}\n`);
}

async function enviar(email, subject, html, descricaoDev, link) {
  // Espelha SEMPRE, e antes de tentar entregar: se o Resend recusar, o dado
  // já está no terminal.
  espelharNoTerminal(email, subject, descricaoDev, link);

  if (!resend) {
    return;
  }
  // O SDK do Resend NAO lanca excecao em erro de API: ele retorna { data, error }.
  // Precisamos checar o `error` explicitamente.
  let resposta;
  try {
    resposta = await resend.emails.send({ from: REMETENTE, to: email, subject, html });
  } catch (e) {
    console.error(`[EMAIL] Erro de rede ao enviar para ${email}:`, e.message);
    return;
  }
  if (resposta && resposta.error) {
    console.error(`[EMAIL] Resend recusou o envio para ${email}: ${resposta.error.message || JSON.stringify(resposta.error)}`);
    console.error('[EMAIL] Causa provavel: o remetente "onboarding@resend.dev" so entrega para o e-mail dono da conta Resend.');
    console.error('[EMAIL] Para enviar a QUALQUER destinatario (alunos), verifique um dominio no Resend e use um remetente desse dominio em EMAIL_REMETENTE.');
    return;
  }
  console.log(`[EMAIL] Entregue ao Resend: "${subject}" -> ${email}`);
  return resposta && resposta.data;
}

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
  // O código vai no lugar do "link" pra aparecer em destaque no terminal —
  // é o dado que você precisa copiar durante o login de teste.
  await enviar(email, 'Seu código de acesso — Secretaria CVB-RJ', html, 'Código 2FA da secretaria', `CODIGO: ${codigo}`);
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
  await enviar(email, 'Alerta de acesso — Secretaria CVB-RJ', html, `Alerta de login da secretaria (${quando}, IP ${ip || '?'})`, null);
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

// ═════════════════════════════════════════════════════════════════════════
// LEMBRETES DE PAGAMENTO PENDENTE
//
// Contexto: no plano PARCELADO a taxa de inscrição e o curso são duas
// cobranças separadas. Muita gente pagava a taxa e fechava a aba, ficando
// com a matrícula PENDENTE — dinheiro já entrou, vaga reservada, matrícula
// não efetivada. Estes dois e-mails puxam essa pessoa de volta.
//
// Os dois dizem, com todas as letras, que a taxa JÁ FOI PAGA. É a dúvida
// número um de quem abandonou o fluxo ("será que perdi o que paguei?") e é
// o que faz a pessoa clicar.
//
// Quem dispara: src/lib/lembretes.js (job automático e botão da secretaria).
// ═════════════════════════════════════════════════════════════════════════

// Caixa com o resumo do valor, compartilhada pelos dois e-mails.
function blocoValor({ numParcelas, valorParcela, total, taxaPaga }) {
  const linhaParcelas = numParcelas > 1
    ? `<strong style="font-size:20px;color:#0b0c0e;">${numParcelas}× de ${valorParcela}</strong><br>
       <span style="color:#718096;font-size:13px;">no cartão de crédito — total ${total}</span>`
    : `<strong style="font-size:20px;color:#0b0c0e;">${total}</strong><br>
       <span style="color:#718096;font-size:13px;">no cartão de crédito</span>`;

  return `
    <div style="background:#f5f6f9;border:1px solid #e7ebf2;border-radius:10px;padding:16px 18px;margin:20px 0;">
      ${linhaParcelas}
      ${taxaPaga ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e7ebf2;color:#0d7a58;font-size:13px;">
        ✓ Taxa de inscrição de ${taxaPaga} já paga — não entra nesta cobrança.
      </div>` : ''}
    </div>`;
}

/**
 * Lembrete 1 — logo após a taxa ser confirmada e a pessoa sumir.
 * Tom informativo: a vaga está guardada, falta só concluir.
 */
async function enviarLembretePagamentoPendente(email, nome, dados) {
  const { curso, inicioTurma, link } = dados;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#cc0000;margin-bottom:8px;">Cruz Vermelha</h2>
      <h3 style="margin-bottom:16px;">Sua vaga está reservada</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Recebemos o pagamento da sua taxa de inscrição em <strong>${curso}</strong>
      e sua vaga está reservada. Falta apenas concluir o pagamento do curso
      para efetivar a matrícula.</p>
      <p style="color:#4a5568;">Turma com início em <strong>${inicioTurma}</strong>.</p>
      ${blocoValor(dados)}
      <a href="${link}" style="display:inline-block;margin:8px 0 24px;background:#cc0000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;">
        Continuar o pagamento
      </a>
      <p style="color:#718096;font-size:13px;">
        Você também pode entrar na sua conta e ir em "Minhas inscrições".
        Qualquer dúvida, fale com a secretaria.
      </p>
    </div>`;
  await enviar(
    email,
    `Falta pouco: conclua sua matrícula em ${curso}`,
    html,
    `Lembrete de pagamento pendente (${curso})`,
    link
  );
}

/**
 * Lembrete 2 — véspera do início da turma, ainda pendente.
 * Aqui a urgência é real: a data existe e está chegando. Nada de escassez
 * inventada — só o fato.
 */
async function enviarLembreteVespera(email, nome, dados) {
  const { curso, inicioTurma, link } = dados;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#cc0000;margin-bottom:8px;">Cruz Vermelha</h2>
      <h3 style="margin-bottom:16px;">Seu curso começa amanhã</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>O curso <strong>${curso}</strong> começa em <strong>${inicioTurma}</strong>
      e sua matrícula ainda não foi concluída.</p>
      <p>Sua taxa de inscrição está paga e a vaga segue reservada, mas o
      pagamento do curso precisa ser feito para você participar.</p>
      ${blocoValor(dados)}
      <a href="${link}" style="display:inline-block;margin:8px 0 24px;background:#cc0000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;">
        Concluir minha matrícula
      </a>
      <p style="color:#718096;font-size:13px;">
        Se você não puder mais participar desta turma, entre em contato com a
        secretaria para tratarmos da sua taxa de inscrição.
      </p>
    </div>`;
  await enviar(
    email,
    `${curso} começa amanhã — sua matrícula está pendente`,
    html,
    `Lembrete de véspera (${curso})`,
    link
  );
}

/**
 * Lembrete 3 — inscrição iniciada e abandonada ANTES de qualquer pagamento.
 *
 * Diferente dos dois acima: aqui nada foi pago, então o tom não é "sua vaga
 * está guardada" (não está) e sim "sua vaga ainda não está garantida". Nunca
 * afirme que a taxa foi paga neste caso — seria mentira e geraria conflito
 * na secretaria depois.
 */
async function enviarLembreteInscricaoIncompleta(email, nome, dados) {
  const { curso, inicioTurma, link, valorTaxa } = dados;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      <h2 style="color:#cc0000;margin-bottom:8px;">Cruz Vermelha</h2>
      <h3 style="margin-bottom:16px;">Sua inscrição ficou pela metade</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Você começou a inscrição no curso <strong>${curso}</strong>, mas o
      pagamento não foi concluído — então sua vaga ainda não está garantida.</p>
      <p style="color:#4a5568;">A turma começa em <strong>${inicioTurma}</strong>.</p>
      ${valorTaxa ? `<div style="background:#f5f6f9;border:1px solid #e7ebf2;border-radius:10px;padding:16px 18px;margin:20px 0;">
        <span style="color:#718096;font-size:13px;">Taxa de inscrição</span><br>
        <strong style="font-size:20px;color:#0b0c0e;">${valorTaxa}</strong>
      </div>` : ''}
      <a href="${link}" style="display:inline-block;margin:8px 0 24px;background:#cc0000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;">
        Retomar minha inscrição
      </a>
      <p style="color:#718096;font-size:13px;">
        Se você não tem mais interesse, pode ignorar este e-mail.
        Qualquer dúvida, fale com a secretaria.
      </p>
    </div>`;
  await enviar(
    email,
    `Sua inscrição em ${curso} não foi concluída`,
    html,
    `Lembrete de inscrição incompleta (${curso})`,
    link
  );
}

module.exports = {
  enviarEmailResetSenha,
  enviarEmailConfirmacao,
  enviarCodigo2fa,
  enviarAlertaLoginSecretaria,
  enviarLinkDesbloqueio,
  enviarLembretePagamentoPendente,
  enviarLembreteVespera,
  enviarLembreteInscricaoIncompleta,
};