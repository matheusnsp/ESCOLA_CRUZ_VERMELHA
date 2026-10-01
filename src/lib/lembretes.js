// ═════════════════════════════════════════════════════════════════════════
// LEMBRETES DE PAGAMENTO PENDENTE
//
// Problema que resolve: no plano PARCELADO a taxa de inscrição e o curso são
// duas cobranças separadas. Quem paga a taxa e fecha a aba fica com a
// matrícula PENDENTE — o dinheiro da taxa já entrou, a vaga está ocupada, e
// a matrícula nunca se efetiva. Estes lembretes trazem essa pessoa de volta.
//
// Dois disparos, cada um com uma razão de existir:
//
//   1. IMEDIATO — a taxa foi confirmada, passaram-se CARENCIA_MIN minutos e
//      o curso segue pendente. Tom informativo: a vaga está guardada.
//
//   2. VÉSPERA — a turma começa nas próximas JANELA_VESPERA_H horas e o
//      pagamento continua pendente. Aqui a urgência é real, não inventada.
//
// POR QUE NÃO DISPARAR NO WEBHOOK: no instante em que o webhook confirma a
// TAXA, o aluno normalmente está NA TELA, com o polling rodando, prestes a
// preencher o cartão. Um e-mail dizendo "você não concluiu" chegaria no meio
// do fluxo. Por isso o "imediato" tem carência — é imediato do ponto de
// vista de quem abandonou, não do banco de dados.
//
// COMO RODAR:
//   • Job periódico: agendarLembretes() no server.js (ver instruções).
//   • Manual, pra varrer o passivo atual:
//     node -e "require('./src/lib/lembretes').processarLembretes({ carenciaMin: 0 }).then(r=>{console.log(r);process.exit(0)})"
//   • Simulação, sem enviar nada e sem gravar:
//     node -e "require('./src/lib/lembretes').processarLembretes({ carenciaMin: 0, simular: true }).then(r=>{console.log(r);process.exit(0)})"
// ═════════════════════════════════════════════════════════════════════════

const prisma = require('../db');
const { calcularValores, formatBRL } = require('./matricula');
const { obterOpcaoParcelamento } = require('./unicopag');
const {
  enviarLembretePagamentoPendente,
  enviarLembreteVespera,
  enviarLembretePrazoCurso,
  enviarLembreteInscricaoIncompleta,
} = require('./email');

// ── Ajustes de comportamento ─────────────────────────────────────────────
const CARENCIA_MIN = 60;        // minutos após a taxa antes do 1º lembrete
const JANELA_VESPERA_H = 24;    // véspera: a turma começa em até X h
const JANELA_PRAZO_H = 72;      // prazo: a turma começa em até X h (e mais de 24 h)
const LIMITE_POR_PASSADA = 100; // teto de e-mails por execução

function formatarData(d) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// Monta os valores que vão no corpo do e-mail. Mesma conta da etapa 3:
// o juro incide só sobre o curso; a taxa já foi paga e fica de fora.
async function montarValores(matricula) {
  const curso = matricula.turma.curso;
  const valores = await calcularValores(curso, 'PARCELADO', matricula.alunoId);
  const numParcelas = Number(curso.parcelas) || 1;
  const amountCentavos = Math.round(parseFloat(valores.valorCurso) * 100);

  // Se a consulta ao gateway falhar, cai no valor sem juros. É melhor mandar
  // o e-mail com o valor base do que não mandar — a tela mostra o número
  // final de qualquer jeito.
  let opcao = null;
  try {
    opcao = await obterOpcaoParcelamento(amountCentavos, numParcelas);
  } catch (e) {
    console.warn('[LEMBRETES] Parcelamento indisponível, usando valor base:', e.message);
  }

  const total = opcao ? opcao.total_amount / 100 : Number(valores.valorCurso);
  const valorParcela = opcao ? opcao.installment_amount / 100 : total;
  const taxa = Number(valores.valorTaxaMatricula);

  return {
    numParcelas,
    valorParcela: formatBRL(valorParcela),
    total: formatBRL(total),
    taxaPaga: taxa > 0 ? formatBRL(taxa) : null,
  };
}

// Link do job automático: sempre a etapa 3 (o job só trata o caso
// "taxa paga, falta o curso"). Os outros casos são cobertos pelo contato
// avulso da secretaria, mais abaixo em montarPendencia().
function montarLink(turmaId) {
  const base = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';
  return `${base.replace(/\/+$/, '')}/inscrever/${turmaId}/pagar-curso`;
}

// Critério comum: matrícula com a taxa paga e o curso não.
// PRESENCIAL fica de fora porque lá o curso é pago na secretaria, não online
// — não há link pra onde mandar a pessoa.
function filtroBase() {
  return {
    statusPagamento: 'PENDENTE',
    taxaConfirmada: true,
    plano: 'PARCELADO',
    turma: { status: { in: ['ABERTA', 'CONFIRMADA'] } },
  };
}

const INCLUDE_PADRAO = {
  aluno: { select: { nome: true, email: true } },
  turma: { include: { curso: true } },
};

// Cada lembrete sai UMA vez por matrícula, mesmo com os 3 serviços do Render rodando a passada ao
// mesmo tempo: a marcação é gravada ANTES do envio e só um deles consegue gravar.
//   imediato / vespera → campos lembreteImediatoEm / lembreteVesperaEm (updateMany com null)
//   prazo              → registro no LogAuditoria com id fixo por matrícula (id duplicado falha)
async function reservar(m, tipo) {
  if (tipo === 'prazo') {
    try {
      await prisma.logAuditoria.create({ data: { id: `lembrete-prazo-${m.id}`, atorId: 'SISTEMA', acao: 'LEMBRETE_PRAZO_CURSO', alvoTipo: 'Matricula', alvoId: m.id } });
      return true;
    } catch (e) {
      if (e.code === 'P2002') return false;
      throw e;
    }
  }
  const campo = tipo === 'vespera' ? 'lembreteVesperaEm' : 'lembreteImediatoEm';
  const r = await prisma.matricula.updateMany({ where: { id: m.id, [campo]: null }, data: { [campo]: new Date() } });
  return r.count === 1;
}

async function desfazerReserva(m, tipo) {
  if (tipo === 'prazo') await prisma.logAuditoria.deleteMany({ where: { id: `lembrete-prazo-${m.id}` } });
  else await prisma.matricula.update({ where: { id: m.id }, data: { [tipo === 'vespera' ? 'lembreteVesperaEm' : 'lembreteImediatoEm']: null } });
}

async function despachar(m, tipo, simular) {
  const primeiroNome = String(m.aluno.nome || '').split(' ')[0];
  const valores = await montarValores(m);
  const dados = {
    ...valores,
    curso: m.turma.curso.nome,
    inicioTurma: formatarData(m.turma.inicioPrevisto),
    link: montarLink(m.turmaId),
  };

  if (simular) {
    console.log(`[LEMBRETES] (simulação) ${tipo} → ${m.aluno.email} | ${dados.curso} | ${dados.numParcelas}× ${dados.valorParcela}`);
    return false;
  }
  if (!(await reservar(m, tipo))) return false; // outro serviço já mandou

  try {
    if (tipo === 'vespera') await enviarLembreteVespera(m.aluno.email, primeiroNome, dados);
    else if (tipo === 'prazo') await enviarLembretePrazoCurso(m.aluno.email, primeiroNome, dados);
    else await enviarLembretePagamentoPendente(m.aluno.email, primeiroNome, dados);
  } catch (e) {
    await desfazerReserva(m, tipo).catch(() => {}); // tenta de novo na próxima passada
    throw e;
  }
  console.log(`[LEMBRETES] ${tipo} enviado → ${m.aluno.email} (${dados.curso})`);
  return true;
}

/**
 * Varre as matrículas com a taxa paga e o curso pendente e manda a sequência de lembretes:
 *   1. imediato — 1 h depois da taxa (a pessoa fechou a tela sem pagar o curso);
 *   2. prazo    — a turma começa em até 3 dias (e o imediato saiu há mais de 12 h);
 *   3. véspera  — a turma começa em até 24 h.
 * Todos deixam claro que sem o curso pago a entrada na aula não é liberada.
 *
 * @param {object} opts
 * @param {number} opts.carenciaMin  Minutos desde a confirmação da taxa (default CARENCIA_MIN).
 * @param {boolean} opts.simular     Só imprime no console, não envia nem grava.
 */
async function processarLembretes(opts = {}) {
  const carenciaMin = opts.carenciaMin != null ? opts.carenciaMin : CARENCIA_MIN;
  const simular = !!opts.simular;
  const resumo = { imediatos: 0, prazos: 0, vesperas: 0, erros: 0 };

  const agora = new Date();
  const corteCarencia = new Date(agora.getTime() - carenciaMin * 60000);
  const limiteVespera = new Date(agora.getTime() + JANELA_VESPERA_H * 3600000);
  const limitePrazo = new Date(agora.getTime() + JANELA_PRAZO_H * 3600000);
  const tocadaHaPouco = new Date(agora.getTime() - 60 * 60000); // abriu a tela do cartão agora

  const lotes = [
    ['imediato', 'imediatos', {
      lembreteImediatoEm: null,
      taxaConfirmadaEm: { lt: corteCarencia },
      turma: { ...filtroBase().turma, inicioPrevisto: { gt: agora } },
    }],
    ['prazo', 'prazos', {
      atualizadoEm: { lt: tocadaHaPouco },
      OR: [{ lembreteImediatoEm: null }, { lembreteImediatoEm: { lt: new Date(agora.getTime() - 12 * 3600000) } }],
      turma: { ...filtroBase().turma, inicioPrevisto: { gt: limiteVespera, lte: limitePrazo } },
    }],
    ['vespera', 'vesperas', {
      lembreteVesperaEm: null,
      atualizadoEm: { lt: tocadaHaPouco },
      turma: { ...filtroBase().turma, inicioPrevisto: { gt: agora, lte: limiteVespera } },
    }],
  ];

  for (const [tipo, chave, where] of lotes) {
    const lista = await prisma.matricula.findMany({
      where: { ...filtroBase(), ...where },
      include: INCLUDE_PADRAO,
      take: LIMITE_POR_PASSADA,
    });
    for (const m of lista) {
      try {
        if (await despachar(m, tipo, simular)) resumo[chave]++;
      } catch (e) {
        resumo.erros++;
        console.error(`[LEMBRETES] Falha no lembrete ${tipo} da matrícula ${m.id}:`, e.message);
      }
    }
  }

  if (resumo.imediatos || resumo.prazos || resumo.vesperas || resumo.erros) {
    console.log('[LEMBRETES] Passada concluída:', resumo);
  }
  return resumo;
}

/**
 * Agenda a varredura periódica. Chamada no server.js. Roda nos 3 serviços do Render; a reserva
 * feita antes do envio (reservar) garante um e-mail só por lembrete.
 */
function agendarLembretes(intervaloMin = 15) {
  setInterval(() => {
    processarLembretes().catch((e) =>
      console.error('[LEMBRETES] Erro na passada agendada:', e.message));
  }, intervaloMin * 60000);
  console.log(`[LEMBRETES] Job agendado a cada ${intervaloMin} min.`);
}

// ═════════════════════════════════════════════════════════════════════════
// CONTATO AVULSO (tela /pendentes da secretaria)
//
// Aqui a coisa é mais ampla que o job automático: a secretária precisa
// conseguir falar com QUALQUER pendência, não só com o caso PARCELADO que a
// automação cobre. Cada situação tem um link e um texto diferentes — e em
// uma delas não existe link nenhum.
//
// As quatro situações:
//
//   'curso'      taxa paga + PARCELADO → falta a matrícula, pagável online.
//   'taxa'       nada pago + PARCELADO/PRESENCIAL → falta a taxa, online.
//   'inicio'     nada pago + A_VISTA → refaz o fluxo do zero (a matrícula é
//                "fantasma" e /inscrever/:turmaId reabre a tela normal).
//   'secretaria' taxa paga + A_VISTA/PRESENCIAL → não há pagamento online do
//                curso nesses planos. Só contato humano.
//
// IMPORTANTE: em 'taxa' e 'inicio' NADA foi pago. O texto jamais pode dizer
// que a vaga está reservada — ela não está. Dizer isso geraria conflito na
// secretaria depois.
// ═════════════════════════════════════════════════════════════════════════

function baseUrl() {
  const base = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';
  return base.replace(/\/+$/, '');
}

/**
 * Classifica a pendência e devolve link + capacidades.
 * Usada tanto pela tela (pra montar os botões) quanto pelo envio de e-mail.
 */
function montarPendencia(m) {
  const t = m.turmaId;

  if (m.taxaConfirmada && m.plano === 'PARCELADO') {
    return { etapa: 'curso', link: `${baseUrl()}/inscrever/${t}/pagar-curso`, podeEmail: true };
  }
  if (!m.taxaConfirmada && (m.plano === 'PARCELADO' || m.plano === 'PRESENCIAL')) {
    return { etapa: 'taxa', link: `${baseUrl()}/inscrever/${t}/pagar-taxa`, podeEmail: true };
  }
  if (!m.taxaConfirmada && m.plano === 'A_VISTA') {
    return { etapa: 'inicio', link: `${baseUrl()}/inscrever/${t}`, podeEmail: true };
  }
  // taxa paga + A_VISTA/PRESENCIAL: sem etapa online pra apontar.
  return { etapa: 'secretaria', link: `${baseUrl()}/minha-conta?sec=inscricoes`, podeEmail: false };
}

/**
 * Texto pronto do WhatsApp, por situação.
 *
 * Sai do número de quem clicou (o link abre a conversa no WhatsApp da
 * pessoa logada no computador), então o texto se apresenta como "aqui é da
 * Escola" — a aluna não necessariamente tem o número salvo.
 */
function montarTextoWhats(m, pendencia) {
  const nome = String(m.aluno?.nome || '').split(' ')[0];
  const curso = m.turma.curso.nome;
  const inicio = formatarData(m.turma.inicioPrevisto);
  const cabecalho = `Olá, ${nome}! Aqui é da Escola de Educação e Saúde da Cruz Vermelha RJ.`;

  if (pendencia.etapa === 'curso') {
    return `${cabecalho}\n\n`
      + `Sua taxa de inscrição no curso ${curso} está paga e sua vaga está reservada. `
      + `Falta só pagar a matrícula para garantir sua participação.\n\n`
      + `A turma começa em ${inicio}. Você pode concluir por aqui:\n${pendencia.link}`;
  }

  if (pendencia.etapa === 'secretaria') {
    return `${cabecalho}\n\n`
      + `Sua taxa de inscrição no curso ${curso} está paga, mas a matrícula ainda não foi paga.\n\n`
      + `A turma começa em ${inicio}. Pode falar comigo por aqui pra finalizarmos?`;
  }

  // 'taxa' e 'inicio': nada foi pago ainda.
  return `${cabecalho}\n\n`
    + `Vimos que você começou a inscrição no curso ${curso}, mas o pagamento não foi concluído — `
    + `então sua vaga ainda não está garantida.\n\n`
    + `A turma começa em ${inicio}. Você pode retomar por aqui:\n${pendencia.link}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Monta a URL do WhatsApp com o texto já preenchido.
//
// 💡 web.whatsapp.com/send, NÃO wa.me.
//
// O wa.me tenta abrir o aplicativo desktop primeiro. Em máquina sem o
// WhatsApp instalado ele não tem pra onde ir e o resultado é uma aba em
// branco — aconteceu com uma pessoa da secretaria, e o link ficava parado
// na URL do próprio POST.
//
// Não dá pra detectar se o app existe: o navegador não expõe essa
// informação, nem pro servidor nem pro JavaScript da página. Então em vez
// de escolher entre dois caminhos, usamos o que atende os dois casos —
// quem tem o app instalado recebe do próprio WhatsApp Web a oferta de
// abrir nele, e quem não tem segue no navegador.
//
// Assume Brasil (DDI 55). Retorna null se o celular não tiver 10 ou 11
// dígitos, pra não gerar link quebrado.
// ─────────────────────────────────────────────────────────────────────────
function urlWhatsApp(digitos, texto) {
  return `https://web.whatsapp.com/send?phone=55${digitos}&text=${encodeURIComponent(texto)}`;
}

/**
 * Link do WhatsApp com o texto da pendência já preenchido.
 * Retorna null se o celular cadastrado não tiver 10 ou 11 dígitos.
 */
function montarLinkWhats(m) {
  const digitos = String(m.aluno?.celular || '').replace(/\D/g, '');
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  const pendencia = montarPendencia(m);
  const texto = montarTextoWhats(m, pendencia);
  return urlWhatsApp(digitos, texto);
}

/**
 * Envio AVULSO por e-mail, disparado pela secretaria na tela /pendentes.
 *
 * Diferente do job: NÃO checa as marcas de já-enviado. Se a secretária
 * clicou, é porque decidiu mandar — talvez ela tenha acabado de falar com a
 * aluna no telefone, ou queira um empurrão fora da cadência automática. A
 * decisão humana sobrepõe a automação.
 *
 * Retorna { ok, motivo?, email?, tipo? } em vez de lançar — a rota do admin
 * usa isso pra montar a mensagem de volta pra secretária.
 */
async function enviarLembreteAvulso(matriculaId) {
  const m = await prisma.matricula.findUnique({
    where: { id: matriculaId },
    include: INCLUDE_PADRAO,
  });

  if (!m) return { ok: false, motivo: 'Inscrição não encontrada.' };
  if (m.statusPagamento !== 'PENDENTE') {
    return { ok: false, motivo: 'Esta inscrição não tem matrícula pendente.' };
  }
  if (!m.aluno.email) {
    return { ok: false, motivo: 'O aluno não tem e-mail cadastrado.' };
  }

  const pendencia = montarPendencia(m);
  if (!pendencia.podeEmail) {
    return {
      ok: false,
      motivo: 'Neste plano a matrícula é paga na secretaria — não há link online pra enviar. Use o WhatsApp ou o telefone.',
    };
  }

  const primeiroNome = String(m.aluno.nome || '').split(' ')[0];
  const inicioTurma = formatarData(m.turma.inicioPrevisto);
  const curso = m.turma.curso.nome;

  // ── Nada foi pago ainda: e-mail de inscrição incompleta ────────────────
  if (pendencia.etapa === 'taxa' || pendencia.etapa === 'inicio') {
    const valores = await calcularValores(
      m.turma.curso,
      m.plano === 'PARCELADO' ? 'PARCELADO' : 'A_VISTA',
      m.alunoId
    );
    const taxa = Number(valores.valorTaxaMatricula);
    await enviarLembreteInscricaoIncompleta(m.aluno.email, primeiroNome, {
      curso,
      inicioTurma,
      link: pendencia.link,
      valorTaxa: taxa > 0 ? formatBRL(taxa) : null,
    });
    await prisma.matricula.update({
      where: { id: m.id },
      data: { lembreteImediatoEm: new Date() },
    });
    console.log(`[LEMBRETES] avulso (incompleta) -> ${m.aluno.email}`);
    return { ok: true, email: m.aluno.email, tipo: 'incompleta' };
  }

  // ── Taxa paga, falta a matrícula ───────────────────────────────────────────
  const valores = await montarValores(m);
  const dados = { ...valores, curso, inicioTurma, link: pendencia.link };

  // Perto do início da turma o texto de urgência faz mais sentido.
  const horasAteInicio = (new Date(m.turma.inicioPrevisto) - Date.now()) / 3600000;
  const usarVespera = horasAteInicio > 0 && horasAteInicio <= JANELA_VESPERA_H;

  if (usarVespera) {
    await enviarLembreteVespera(m.aluno.email, primeiroNome, dados);
    await prisma.matricula.update({
      where: { id: m.id },
      data: { lembreteVesperaEm: new Date() },
    });
  } else {
    await enviarLembretePagamentoPendente(m.aluno.email, primeiroNome, dados);
    // Marca também no campo do automático, pra não chegar um segundo
    // e-mail idêntico logo depois pelo job.
    await prisma.matricula.update({
      where: { id: m.id },
      data: { lembreteImediatoEm: new Date() },
    });
  }

  console.log(`[LEMBRETES] avulso (${usarVespera ? 'vespera' : 'imediato'}) -> ${m.aluno.email}`);
  return { ok: true, email: m.aluno.email, tipo: usarVespera ? 'vespera' : 'imediato' };
}

// ═════════════════════════════════════════════════════════════════════════
// PROSPECÇÃO (tela /alunos, filtro "sem inscrição")
//
// Natureza diferente de tudo acima: aqui a pessoa criou conta e nunca se
// inscreveu em nada. Não há pendência, não há dinheiro em jogo, não há
// relação em curso — é abordagem fria.
//
// Por isso o texto:
//   • não cita preço nem link de pagamento (seria propaganda);
//   • termina em PERGUNTA, convidando resposta em vez de empurrar. Conversa
//     converte melhor que anúncio e reduz a chance de o número ser marcado
//     como spam — o que derrubaria o canal usado com os pendentes, onde o
//     dinheiro de fato está;
//   • cita turmas ABERTAS de verdade, puxadas do banco na hora, pra nunca
//     oferecer curso que já lotou ou encerrou.
//
// ⚠️ LGPD: o consentimento que o aluno aceitou no cadastro cobre a execução
// do serviço. Comunicação promocional costuma exigir base legal própria.
// Vale conferir o texto aceito antes de usar isto em escala.
// ═════════════════════════════════════════════════════════════════════════

/**
 * Monta o texto de prospecção, citando até 3 turmas abertas.
 * @param {object} aluno              { nome }
 * @param {Array}  turmasAbertas      turmas com .curso.nome, já filtradas
 */
function montarTextoProspeccao(aluno, turmasAbertas = []) {
  const nome = String(aluno?.nome || '').split(' ')[0];
  const cabecalho = `Olá, ${nome}! Aqui é da Escola de Educação e Saúde da Cruz Vermelha RJ.`;

  // Nomes únicos: a mesma disciplina pode ter mais de uma turma aberta.
  const nomes = [...new Set(turmasAbertas.map((t) => t.curso.nome))].slice(0, 3);

  let oferta;
  if (nomes.length === 0) {
    oferta = 'Estamos com turmas abrindo para os próximos meses.';
  } else if (nomes.length === 1) {
    oferta = `Estamos com turma aberta de ${nomes[0]}.`;
  } else {
    const ultimo = nomes.pop();
    oferta = `Estamos com turmas abertas de ${nomes.join(', ')} e ${ultimo}.`;
  }

  return `${cabecalho}\n\n`
    + `Vi que você criou uma conta no nosso site, mas ainda não se inscreveu em nenhum curso. `
    + `${oferta}\n\n`
    + `Quer que eu te conte sobre alguma?`;
}

/**
 * Link do WhatsApp para prospecção. Ver urlWhatsApp() acima.
 * Retorna null se o celular cadastrado não tiver 10 ou 11 dígitos.
 */
function montarLinkProspeccao(aluno, turmasAbertas = []) {
  const digitos = String(aluno?.celular || '').replace(/\D/g, '');
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  const texto = montarTextoProspeccao(aluno, turmasAbertas);
  return urlWhatsApp(digitos, texto);
}

module.exports = {
  processarLembretes,
  agendarLembretes,
  enviarLembreteAvulso,
  montarPendencia,
  montarLinkWhats,
  montarTextoWhats,   // 💡 NOVO — a página de contato mostra o texto na tela,
                      // pra secretaria conferir antes de mandar
  montarLinkProspeccao,
  montarTextoProspeccao,
};