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
  enviarLembreteInscricaoIncompleta,
} = require('./email');

// ── Ajustes de comportamento ─────────────────────────────────────────────
const CARENCIA_MIN = 60;        // minutos após a taxa antes do 1º lembrete
const JANELA_VESPERA_H = 24;    // manda o 2º quando a turma começa em até X h
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
    return;
  }

  if (tipo === 'vespera') {
    await enviarLembreteVespera(m.aluno.email, primeiroNome, dados);
    await prisma.matricula.update({
      where: { id: m.id },
      data: { lembreteVesperaEm: new Date() },
    });
  } else {
    await enviarLembretePagamentoPendente(m.aluno.email, primeiroNome, dados);
    await prisma.matricula.update({
      where: { id: m.id },
      data: { lembreteImediatoEm: new Date() },
    });
  }
  console.log(`[LEMBRETES] ${tipo} enviado → ${m.aluno.email} (${dados.curso})`);
}

/**
 * Varre as matrículas elegíveis e dispara os dois tipos de lembrete.
 *
 * @param {object} opts
 * @param {number} opts.carenciaMin  Minutos desde a confirmação da taxa (default CARENCIA_MIN). Use 0 pra varrer o passivo.
 * @param {boolean} opts.simular     Só imprime no console, não envia nem grava.
 * @returns {Promise<{imediatos:number, vesperas:number, erros:number}>}
 */
async function processarLembretes(opts = {}) {
  const carenciaMin = opts.carenciaMin != null ? opts.carenciaMin : CARENCIA_MIN;
  const simular = !!opts.simular;
  const resumo = { imediatos: 0, vesperas: 0, erros: 0 };

  const agora = new Date();
  const corteCarencia = new Date(agora.getTime() - carenciaMin * 60000);
  const limiteVespera = new Date(agora.getTime() + JANELA_VESPERA_H * 3600000);

  // ── 1. IMEDIATO ────────────────────────────────────────────────────────
  // Taxa confirmada há mais de `carenciaMin` e nunca lembrado.
  const imediatos = await prisma.matricula.findMany({
    where: {
      ...filtroBase(),
      lembreteImediatoEm: null,
      taxaConfirmadaEm: { lt: corteCarencia },
      // Turma que já começou não recebe este lembrete — só o de véspera faz
      // sentido perto da data, e passada a data nenhum dos dois faz.
      turma: { ...filtroBase().turma, inicioPrevisto: { gt: agora } },
    },
    include: INCLUDE_PADRAO,
    take: LIMITE_POR_PASSADA,
  });

  for (const m of imediatos) {
    try {
      await despachar(m, 'imediato', simular);
      resumo.imediatos++;
    } catch (e) {
      resumo.erros++;
      console.error(`[LEMBRETES] Falha no imediato da matrícula ${m.id}:`, e.message);
    }
  }

  // ── 2. VÉSPERA ─────────────────────────────────────────────────────────
  // Turma começa dentro da janela, ainda pendente, nunca avisado na véspera.
  //
  // O filtro de atualizadoEm evita mandar "você não pagou" pra quem está com
  // uma cobrança em aberto neste exato momento (abriu a tela do cartão há
  // dois minutos) — nesse caso a matrícula acabou de ser tocada.
  const vesperas = await prisma.matricula.findMany({
    where: {
      ...filtroBase(),
      lembreteVesperaEm: null,
      atualizadoEm: { lt: new Date(agora.getTime() - 60 * 60000) },
      turma: {
        ...filtroBase().turma,
        inicioPrevisto: { gt: agora, lte: limiteVespera },
      },
    },
    include: INCLUDE_PADRAO,
    take: LIMITE_POR_PASSADA,
  });

  for (const m of vesperas) {
    try {
      await despachar(m, 'vespera', simular);
      resumo.vesperas++;
    } catch (e) {
      resumo.erros++;
      console.error(`[LEMBRETES] Falha na véspera da matrícula ${m.id}:`, e.message);
    }
  }

  if (resumo.imediatos || resumo.vesperas || resumo.erros) {
    console.log('[LEMBRETES] Passada concluída:', resumo);
  }
  return resumo;
}

/**
 * Agenda a varredura periódica. Chamar uma vez no server.js.
 *
 * ⚠️ Se o app rodar em mais de uma instância (Render com escala > 1), o job
 * roda em todas. Os campos lembrete*Em evitam e-mail duplicado, mas duas
 * instâncias podem passar pela mesma matrícula ao mesmo tempo e enviar duas
 * vezes. Com uma instância só — o caso hoje — não há problema.
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
//   'curso'      taxa paga + PARCELADO → falta o curso, pagável online.
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
 * Sai do número de quem clicou (o wa.me abre a conversa no WhatsApp da
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
      + `Falta só concluir o pagamento do curso para efetivar a matrícula.\n\n`
      + `A turma começa em ${inicio}. Você pode concluir por aqui:\n${pendencia.link}`;
  }

  if (pendencia.etapa === 'secretaria') {
    return `${cabecalho}\n\n`
      + `Sua taxa de inscrição no curso ${curso} está paga, mas a matrícula ainda não foi concluída.\n\n`
      + `A turma começa em ${inicio}. Pode falar comigo por aqui pra finalizarmos?`;
  }

  // 'taxa' e 'inicio': nada foi pago ainda.
  return `${cabecalho}\n\n`
    + `Vimos que você começou a inscrição no curso ${curso}, mas o pagamento não foi concluído — `
    + `então sua vaga ainda não está garantida.\n\n`
    + `A turma começa em ${inicio}. Você pode retomar por aqui:\n${pendencia.link}`;
}

/**
 * Link wa.me com o texto já preenchido. Assume Brasil (DDI 55).
 * Retorna null se o celular cadastrado não tiver 10 ou 11 dígitos.
 */
function montarLinkWhats(m) {
  const digitos = String(m.aluno?.celular || '').replace(/\D/g, '');
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  const pendencia = montarPendencia(m);
  const texto = montarTextoWhats(m, pendencia);
  return `https://wa.me/55${digitos}?text=${encodeURIComponent(texto)}`;
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

  if (!m) return { ok: false, motivo: 'Matrícula não encontrada.' };
  if (m.statusPagamento !== 'PENDENTE') {
    return { ok: false, motivo: 'Esta matrícula não está pendente.' };
  }
  if (!m.aluno.email) {
    return { ok: false, motivo: 'O aluno não tem e-mail cadastrado.' };
  }

  const pendencia = montarPendencia(m);
  if (!pendencia.podeEmail) {
    return {
      ok: false,
      motivo: 'Neste plano o curso é pago na secretaria — não há link online pra enviar. Use o WhatsApp ou o telefone.',
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

  // ── Taxa paga, falta o curso ───────────────────────────────────────────
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
 * Link wa.me de prospecção. Assume Brasil (DDI 55).
 * Retorna null se o celular cadastrado não tiver 10 ou 11 dígitos.
 */
function montarLinkProspeccao(aluno, turmasAbertas = []) {
  const digitos = String(aluno?.celular || '').replace(/\D/g, '');
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  const texto = montarTextoProspeccao(aluno, turmasAbertas);
  return `https://wa.me/55${digitos}?text=${encodeURIComponent(texto)}`;
}

module.exports = {
  processarLembretes,
  agendarLembretes,
  enviarLembreteAvulso,
  montarPendencia,
  montarLinkWhats,
  montarLinkProspeccao,
};