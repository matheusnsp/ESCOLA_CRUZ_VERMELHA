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
// Cabeçalho visual de todos os e-mails.
//
// Numa constante só porque o HTML estava repetido em oito funções — trocar
// a logo exigia caçar cada uma.
//
// A imagem precisa estar numa URL PÚBLICA: cliente de e-mail não carrega
// arquivo local nem anexo embutido de forma confiável. Ela mora no próprio
// site (src/public/img/), servida pelo express.static — versionada junto do
// código, sem depender de outro serviço.
//
// PNG, não WebP: Outlook desktop e alguns webmails não renderizam WebP, e o
// aluno veria um quadrado vazio.
//
// O `alt` não é enfeite. Vários clientes bloqueiam imagem por padrão (o
// Outlook pede permissão), então o texto alternativo é o que essas pessoas
// vão ler no lugar da logo — por isso ele diz o nome por extenso.
// ─────────────────────────────────────────────────────────────────────────
// O ?v=2 no fim NÃO é enfeite. O express.static serve com cache de 7 dias e
// o Gmail ainda guarda uma cópia no proxy dele — trocando só o arquivo, sem
// mexer na URL, parte das pessoas continuaria vendo a logo antiga por dias.
// Query string diferente = URL diferente = cache furado, sem precisar
// renomear o arquivo. Se trocar a arte de novo, suba pra v=3.
const LOGO_URL = process.env.EMAIL_LOGO_URL
  || 'https://escola.cursoscruzvermelha.org/img/logo-email.png?v=2';

// A logo traz o nome e a filial na própria arte, então não há texto ao lado
// — seria repetição. Largura maior que antes porque a imagem é horizontal,
// não mais o símbolo quadrado.
//
// O `alt` continua importando: vários clientes bloqueiam imagem por padrão
// (o Outlook pede permissão), e é ele que essas pessoas leem no lugar da
// logo. Por isso diz o nome por extenso, não "logo".
const CABECALHO = `
      <img src="${LOGO_URL}"
           alt="Cruz Vermelha Brasileira - Rio de Janeiro"
           width="240"
           style="width:240px;max-width:75%;height:auto;display:block;margin-bottom:22px;border:0;">`;

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — Espelho no terminal.
//
// Antes, o link/código só aparecia no console quando o Resend NÃO estava
// configurado. Com a chave configurada em desenvolvimento, você mandava o
// e-mail e ficava no escuro: pra testar um link de lembrete era preciso
// abrir a caixa de entrada.
//
// Agora todo envio é espelhado no terminal, ANTES da tentativa de entrega —
// assim o dado aparece mesmo se o Resend recusar depois.
//
// ⚠️ SEGURANÇA: link de redefinição de senha e de desbloqueio são
// credenciais. Impressos em produção, ficariam gravados no log do Render, ao
// alcance de qualquer pessoa com acesso ao painel. Por isso o espelho
// completo só sai fora de produção — ou quando você liga EMAIL_DEBUG=1 de
// propósito, ciente disso. Em produção sem a flag, fica só uma linha dizendo
// o que foi enviado e pra quem, sem o conteúdo sensível.
//
// O código 2FA da secretaria NUNCA é espelhado, nem em desenvolvimento —
// ver a nota em enviarCodigo2fa mais abaixo.
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
      ${CABECALHO}
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

/**
 * Boas-vindas + confirmação de e-mail, num envio só.
 *
 * Antes eram duas ideias e um e-mail seco de "clique aqui". Como a pessoa
 * acabou de criar conta, este é o primeiro contato da escola com ela — vale
 * dizer o que dá pra fazer no site e, principalmente, avisar da senha
 * provisória (os 4 últimos dígitos do documento), que é o ponto onde mais
 * gente trava depois.
 *
 * A confirmação continua sendo o objetivo do botão: sem ela não há garantia
 * de que o endereço é real, e é por ele que vão o comprovante de matrícula
 * e os lembretes de pagamento.
 */
async function enviarEmailConfirmacao(email, nome, link) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      ${CABECALHO}
      <h3 style="margin-bottom:16px;">Bem-vindo à Escola de Educação e Saúde</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Sua conta foi criada. A partir de agora você pode se inscrever nos
      nossos cursos, acompanhar seus pagamentos e ver suas matrículas pelo site.</p>

      <p style="margin-top:22px;">Confirme seu e-mail para garantirmos que os
      avisos de matrícula cheguem até você:</p>

      <a href="${link}" style="display:inline-block;margin:18px 0 24px;background:#cc0000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;">
        Confirmar meu e-mail
      </a>

      <div style="background:#f5f6f9;border:1px solid #e7ebf2;border-radius:10px;padding:16px 18px;margin:4px 0 20px;">
        <strong style="display:block;margin-bottom:6px;">Sua senha provisória</strong>
        <span style="color:#4a5568;font-size:14px;">
          São os <strong>4 últimos dígitos</strong> do documento que você usou
          no cadastro. Entre com ela e troque por uma senha sua em
          "Minha conta &rsaquo; Segurança".
        </span>
      </div>

      <p style="color:#718096;font-size:13px;">
        O link de confirmação expira em 24 horas. Se não foi você quem criou
        esta conta, ignore este e-mail.
      </p>
    </div>`;
  await enviar(email, 'Bem-vindo — confirme seu e-mail | Escola CVB-RJ', html, 'Boas-vindas + confirmação de e-mail', link);
}

/**
 * Código 2FA da secretaria.
 *
 * ⚠️ O CÓDIGO NÃO VAI PRO TERMINAL — nem em desenvolvimento. Ele é o segundo
 * fator do login administrativo: quem enxerga o log do servidor passaria a
 * ter os dois fatores (senha vazada + código impresso), e o 2FA deixaria de
 * proteger qualquer coisa. Por isso o último argumento é null, e a descrição
 * diz apenas QUE um código foi enviado, nunca QUAL.
 *
 * Pra testar o login da secretaria, pegue o código na caixa de entrada.
 */
async function enviarCodigo2fa(email, nome, codigo) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      ${CABECALHO}
      <h3 style="margin-bottom:16px;">Código de acesso à secretaria</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Use o código abaixo para concluir o login no painel da secretaria:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#0b1220;background:#f5f6f9;border:1px solid #e7ebf2;border-radius:12px;padding:18px 0;text-align:center;margin:22px 0;">${codigo}</div>
      <p style="color:#718096;font-size:13px;">O código expira em 10 minutos. Se não foi você que tentou entrar, troque sua senha imediatamente.</p>
    </div>`;
  await enviar(email, 'Seu código de acesso — Secretaria CVB-RJ', html, 'Código 2FA da secretaria (código não exibido por segurança)', null);
}

async function enviarAlertaLoginSecretaria(email, nome, quando, ip) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      ${CABECALHO}
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
      ${CABECALHO}
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
      ${CABECALHO}
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
      ${CABECALHO}
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

// ═════════════════════════════════════════════════════════════════════════
// MATRÍCULA CONFIRMADA
//
// Disparado pelo webhook quando o pagamento do CURSO é confirmado — o
// momento em que a matrícula de fato existe. Antes disto o aluno pagava e
// não recebia nada: só via a tela mudar, sem nenhum comprovante no e-mail.
//
// Além de confirmar, o e-mail resolve as três perguntas que a secretaria
// mais ouve depois: quando começa, onde é, e o que levar.
// ═════════════════════════════════════════════════════════════════════════

// Endereço da escola. Não existe no banco, então mora aqui. Se um dia mudar
// (ou houver turma em outro local), dá pra sobrescrever por ESCOLA_ENDERECO
// no .env sem mexer no código.
const ESCOLA_ENDERECO = process.env.ESCOLA_ENDERECO
  || 'Praça Cruz Vermelha, 10 — Centro, Rio de Janeiro/RJ';

// O que levar no primeiro dia. Ajuste conforme a orientação da escola.
const ESCOLA_LEVAR = process.env.ESCOLA_LEVAR
  || 'Documento oficial com foto';

/**
 * @param {object} dados
 *   curso        nome do curso
 *   inicioTurma  data de início, já formatada (dd/mm/aaaa)
 *   aulas        [{ data: 'dd/mm/aaaa', horario: '09:00 - 17:00' }] — opcional
 *   valorPago    string formatada — opcional
 *   plano        'A_VISTA' | 'PARCELADO' | 'PRESENCIAL'
 *   parcelas     nº de parcelas, quando parcelado — opcional
 *   alimento     true se a turma pede o 1kg de alimento
 *   link         URL de "Minhas inscrições"
 */
async function enviarEmailMatriculaConfirmada(email, nome, dados) {
  const { curso, inicioTurma, aulas, valorPago, plano, parcelas, alimento, link } = dados;

  // Cronograma completo quando a turma tem as aulas cadastradas; senão, só
  // a data de início. Vale a pena listar: evita o aluno aparecer no dia
  // errado, que é um problema caro pra secretaria resolver.
  const blocoAulas = (aulas && aulas.length)
    ? `<table style="width:100%;border-collapse:collapse;margin:6px 0 0;">
         ${aulas.map((a) => `
           <tr>
             <td style="padding:4px 0;color:#4a5568;font-size:14px;">${a.data}</td>
             <td style="padding:4px 0;color:#4a5568;font-size:14px;text-align:right;">${a.horario || ''}</td>
           </tr>`).join('')}
       </table>`
    : `<span style="color:#4a5568;font-size:14px;">Início em <strong>${inicioTurma}</strong></span>`;

  const linhaPagamento = plano === 'PARCELADO' && parcelas > 1
    ? `Pago em ${parcelas}× no cartão de crédito${valorPago ? ' — total ' + valorPago : ''}.`
    : `Pagamento confirmado${valorPago ? ' — ' + valorPago : ''}.`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
      ${CABECALHO}
      <h3 style="margin-bottom:16px;">Matrícula confirmada</h3>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Sua matrícula em <strong>${curso}</strong> está confirmada.
      ${linhaPagamento}</p>

      <div style="background:#eefaf5;border:1px solid #cfe9de;border-radius:10px;padding:16px 18px;margin:20px 0;">
        <strong style="display:block;margin-bottom:8px;color:#0a5c43;">Quando</strong>
        ${blocoAulas}
      </div>

      <div style="background:#f5f6f9;border:1px solid #e7ebf2;border-radius:10px;padding:16px 18px;margin:20px 0;">
        <strong style="display:block;margin-bottom:6px;">Onde</strong>
        <span style="color:#4a5568;font-size:14px;">${ESCOLA_ENDERECO}</span>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #e7ebf2;">
          <strong style="display:block;margin-bottom:6px;">O que levar</strong>
          <span style="color:#4a5568;font-size:14px;">
            ${ESCOLA_LEVAR}${alimento ? '<br>1 kg de alimento não perecível, entregue na secretaria' : ''}
          </span>
        </div>
      </div>

      <a href="${link}" style="display:inline-block;margin:4px 0 24px;background:#cc0000;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;">
        Ver minha matrícula
      </a>

      <p style="color:#718096;font-size:13px;">
        Guarde este e-mail. Qualquer dúvida sobre datas, local ou material,
        fale com a secretaria.
      </p>
    </div>`;

  await enviar(
    email,
    `Matrícula confirmada — ${curso}`,
    html,
    `Matrícula confirmada (${curso})`,
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
  enviarEmailMatriculaConfirmada,
};