const express = require('express');
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { inscricaoSchema, pagamentoTaxaSchema, pagamentoCursoSchema } = require('../lib/validation');
const {
  calcularValores,
  formatBRL,
  lerConfigMatricula,
  totalExibicao,
} = require('../lib/matricula');
const { criarTransacao, obterOpcaoParcelamento } = require('../lib/unicopag');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — Fecha automaticamente turmas cuja data de início já passou,
// marcando-as como CONFIRMADA. As rotas de listagem/inscrição abaixo só
// aceitam status 'ABERTA', então isso já barra novas inscrições sozinho,
// sem precisar de intervenção manual da secretaria. Pra reabrir turma de um
// curso que já passou da data, é preciso criar uma turma nova.
//
// Roda de forma "preguiçosa" (lazy): a cada request às rotas públicas,
// verifica e atualiza o que estiver vencido antes de consultar as listagens.
// Não precisa de cron/scheduler — funciona porque o site é acessado
// regularmente; a primeira visita depois que a data vira já corrige o status.
// ─────────────────────────────────────────────────────────────────────────
async function fecharTurmasVencidas() {
  try {
    await prisma.turma.updateMany({
      where: { status: 'ABERTA', inicioPrevisto: { lte: new Date() } },
      data: { status: 'CONFIRMADA' },
    });
  } catch (e) {
    console.error('[Turmas] Falha ao fechar turmas vencidas:', e.message);
  }
}

router.use(async (req, res, next) => {
  await fecharTurmasVencidas();
  next();
});

// 💡 NOVO — Uma matrícula "fantasma" é aquela criada no banco (necessária pro
// Pagamento da taxa se vincular, no caso Parcelado/Presencial) mas onde a
// pessoa nunca chegou a pagar nada: statusPagamento ainda no estado inicial
// PENDENTE E taxaConfirmada false. Ela fica escondida em "Minha conta" (ver
// conta.js). Sem tratamento especial, o findUnique de "já inscrito" abaixo
// ainda a encontraria e bloquearia a pessoa com um erro genérico mandando
// "ver em Minha conta" — onde não tem nada pra ver.
//
// IMPORTANTE: isso vale pros TRÊS planos (A_VISTA, PARCELADO, PRESENCIAL) —
// no A_VISTA a matrícula também nasce PENDENTE+taxaConfirmada:false até o
// webhook confirmar a transação única (curso+taxa juntos). Por isso a
// correção não pode ser um redirect fixo pra /pagar-taxa (essa rota só
// aceita PARCELADO/PRESENCIAL — um A_VISTA cairia num 404 "Inscrição não
// encontrada"). A solução geral: em vez de bloquear OU redirecionar, deixamos
// a pessoa refazer o fluxo normalmente do zero, e a criação da matrícula
// REAPROVEITA (update) o registro fantasma existente em vez de tentar criar
// um novo (o que violaria a constraint única alunoId+turmaId).
function ehMatriculaFantasma(m) {
  return !!m && m.statusPagamento === 'PENDENTE' && m.taxaConfirmada === false;
}

// Cria a matrícula normalmente — OU, se já existir uma matrícula fantasma
// dessa aluna nessa turma, atualiza (reaproveita) o registro existente em vez
// de inserir um novo. Isso evita erro de constraint única e preserva
// qualquer Pagamento (ex.: taxa PIX já gerado antes) que já esteja vinculado
// ao id dessa matrícula.
async function criarOuRetomarMatricula(alunoId, turmaId, dados) {
  const existente = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId, turmaId } },
  });
  if (existente && ehMatriculaFantasma(existente)) {
    return prisma.matricula.update({ where: { id: existente.id }, data: dados });
  }
  return prisma.matricula.create({ data: { alunoId, turmaId, ...dados } });
}

// Cursos inativos ficam visíveis e matriculáveis apenas para o papel DEV.
// Serve para testar um curso "em construção" sem publicá-lo pros alunos.
function filtroVisibilidadeCurso(usuario) {
  if (usuario?.papel === 'DEV') return {};
  return { ativo: true };
}

// Campos do aluno necessários pro checkout (endereço + documento), reutilizados
// em várias rotas abaixo — evita repetir o mesmo select em cada uma.
const SELECT_ALUNO_CHECKOUT = {
  nome: true, email: true, tipoDocumento: true, cpfCnpj: true, celular: true,
  cep: true, logradouro: true, numero: true, complemento: true, bairro: true,
  cidade: true, uf: true,
};

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO (v3) — CARTÃO SAIU DO FORMULÁRIO DE INSCRIÇÃO
//
// Antes, o crédito era cobrado dentro dos próprios POSTs de inscrição: os
// campos do cartão vinham no mesmo body do plano/forma. Agora o crédito segue
// o mesmo desenho do PIX — o POST só decide o plano, cria/retoma a matrícula e
// manda o aluno para /inscricao/retorno, que exibe a tela dedicada do cartão
// (view inscrever-retorno.ejs) com timer e trilha de etapas.
//
// A cobrança de fato acontece em POST /inscricao/cartao/:matriculaId, que
// responde JSON. Todo o cálculo de valor continua aqui no servidor — o front
// só manda os dados do cartão.
//
// A querystring `t` é a referência da transação: é o que faz o cronômetro da
// tela zerar quando uma transação nova começa e continuar de onde parou num
// simples reload. Não precisa de campo no Prisma.
// ─────────────────────────────────────────────────────────────────────────
function urlRetorno(matriculaId, { pix = false, etapa = 'curso' } = {}) {
  return `/inscricao/retorno?matriculaId=${matriculaId}`
       + `&pix=${pix ? '1' : '0'}&etapa=${etapa}&t=${Date.now()}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Monta o objeto parceladoComJuros PARA A ETAPA 1 (tela de escolha de plano).
// Regra de negócio: o juro do parcelamento incide SÓ sobre o curso; a taxa de
// inscrição é à vista, sem juros, e entra no total por fora.
//   total exibido = (curso COM juros) + (taxa SEM juros)
// Antes, isto consultava o parcelamento sobre parcelado.total (curso + taxa),
// o que fazia o juro cair também sobre a taxa (ex.: R$20 → R$20,74 em vez de
// R$20,37). Mesma lógica já usada na etapa 3 (/pagar-curso), que parcela só o
// valorCurso — aqui só somamos a taxa por fora pra compor o total geral.
// ─────────────────────────────────────────────────────────────────────────
async function montarParceladoComJuros(parcelado, numParcelas) {
  const amountCentavos = Math.round(parseFloat(parcelado.valorCurso) * 100);
  const taxa = Number(parcelado.valorTaxaMatricula);
  const opcao = await obterOpcaoParcelamento(amountCentavos, numParcelas);
  if (!opcao) return null;
  const cursoComJuros = opcao.total_amount / 100;
  return {
    numParcelas,                                  // nº de parcelas do curso
    valorParcela: opcao.installment_amount / 100, // parcela do curso (com juros)
    cursoComJuros,                                // subtotal do curso já com juros
    taxa,                                         // taxa de inscrição (à vista, sem juros)
    total: cursoComJuros + taxa,                  // curso c/ juros + taxa à vista
    taxaJuros: opcao.installment_rate,
  };
}

router.get('/', async (req, res) => {
  const filtro = filtroVisibilidadeCurso(res.locals.usuario);
  const [cursos, cfgMap, total] = await Promise.all([
    prisma.curso.findMany({
      where: filtro,
      orderBy: { nome: 'asc' },
      take: 9, // o carrossel precisa de mais que as 3 colunas visíveis pra ter o que rodar
      include: {
        turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 },
      },
    }),
    lerConfigMatricula(),
    prisma.curso.count({ where: filtro }),
  ]);
  res.render('home', { cursos, cfgMap, temMais: total > cursos.length, formatBRL, totalExibicao });
});

router.get('/sobre', (req, res) => res.render('sobre'));
router.get('/duvidas', (req, res) => res.render('duvidas'));

router.get('/cursos', async (req, res) => {
  const filtro = filtroVisibilidadeCurso(res.locals.usuario);
  const [cursos, cfgMap] = await Promise.all([
    prisma.curso.findMany({
      where: filtro,
      orderBy: { nome: 'asc' },
      include: {
        turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 },
      },
    }),
    lerConfigMatricula(),
  ]);
  res.render('cursos', { cursos, cfgMap, formatBRL, totalExibicao });
});

router.get('/cursos/:cursoId', async (req, res) => {
  const [curso, cfgMap] = await Promise.all([
    prisma.curso.findUnique({
      where: { id: req.params.cursoId },
      include: {
        turmas: {
          where: { status: 'ABERTA' },
          orderBy: { inicioPrevisto: 'asc' },
          include: { aulas: { orderBy: { data: 'asc' }, take: 1 } },
        },
        faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] },
      },
    }),
    lerConfigMatricula(),
  ]);

  // Curso inativo só é visível para o papel DEV (permite testar antes de publicar).
  const podeVer = curso && (curso.ativo || res.locals.usuario?.papel === 'DEV');
  if (!podeVer)
    return res.status(404).render('erro', { mensagem: 'Curso não encontrado.' });

  const outros = await prisma.curso.findMany({
    where: { ...filtroVisibilidadeCurso(res.locals.usuario), id: { not: curso.id } },
    orderBy: { nome: 'asc' },
    take: 3,
    include: {
      turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 },
    },
  });
  res.render('curso-detalhe', {
    curso,
    outros,
    formatBRL,
    total: totalExibicao(curso, cfgMap),
    totalExibicao,
    cfgMap,
  });
});

// ========================================================================
// INSCRIÇÃO — Etapa 1: escolher plano/forma e criar a Matrícula
// ========================================================================
//
// Passaporte (sem CPF/CNPJ) → fluxo 100% presencial, sem gateway, como já
// combinado. Únicopag só aceita document (CPF/CNPJ) no customer.
//
// CPF/CNPJ + A_VISTA     → uma única transação (taxa + curso somados).
//   • PIX     → transação criada aqui mesmo, redireciona pro QR Code.
//   • CRÉDITO → só cria a matrícula e manda pra tela do cartão.
// CPF/CNPJ + PARCELADO   → matrícula criada sem Pagamento ainda; o aluno paga
//   a taxa em /pagar-taxa e, só depois de confirmada, o curso parcelado
//   (cartão) em /pagar-curso.
// CPF/CNPJ + PRESENCIAL  → matrícula criada sem Pagamento ainda; o aluno paga
//   a taxa em /pagar-taxa (PIX ou Cartão) e o curso é pago depois
//   presencialmente na secretaria (sem gateway) em /pagar-curso.

router.get('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } },
  });

  const podeInscrever = turma && turma.status === 'ABERTA'
    && (turma.curso.ativo || res.locals.usuario?.papel === 'DEV');
  if (!podeInscrever)
    return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });

  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  // 💡 matrícula fantasma (nunca pagou nada): não bloqueia. A pessoa vê a tela
  // normal de novo (contrato + escolha de plano) e, ao reenviar o formulário,
  // criarOuRetomarMatricula reaproveita este mesmo registro.
  if (jaInscrito && !ehMatriculaFantasma(jaInscrito))
    return res.render('erro', { mensagem: 'Você já está inscrito nesta turma. Veja em "Minha conta".' });

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { tipoDocumento: true },
  });
  const ehPassaporte = aluno?.tipoDocumento === 'PASSAPORTE';

  const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);

  // Parcelamento só é oferecido a quem tem CPF/CNPJ (gateway) e quando o
  // curso de fato tem mais de 1 parcela configurada.
  let parcelado = null;
  let parceladoComJuros = null;
  const numParcelas = Number(turma.curso.parcelas) || 1;
  if (!ehPassaporte && numParcelas > 1) {
    parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
    parceladoComJuros = await montarParceladoComJuros(parcelado, numParcelas);
  }

  res.render('inscrever', {
    turma, curso: turma.curso, formatBRL,
    aVista, parcelado, parceladoComJuros,
    ehPassaporte,
    etapaAtual: 'escolha',
    erro: req.query.erro === 'expirado'
      ? 'O tempo para concluir o pagamento acabou. A cobrança foi cancelada — você pode começar de novo.'
      : null,
  });
});

router.post('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } },
  });

  const podeInscrever = turma && turma.status === 'ABERTA'
    && (turma.curso.ativo || res.locals.usuario?.papel === 'DEV');
  if (!podeInscrever)
    return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });

  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito && !ehMatriculaFantasma(jaInscrito)) return res.redirect('/minha-conta?jaInscrito=1');

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: SELECT_ALUNO_CHECKOUT,
  });
  const ehPassaporte = aluno?.tipoDocumento === 'PASSAPORTE';

  const reRenderErro = async (msg, etapaAtual = 'escolha') => {
    const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    let parcelado = null, parceladoComJuros = null;
    const numParcelas = Number(turma.curso.parcelas) || 1;
    if (!ehPassaporte && numParcelas > 1) {
      parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
      parceladoComJuros = await montarParceladoComJuros(parcelado, numParcelas);
    }
    return res.status(400).render('inscrever', {
      turma, curso: turma.curso, formatBRL,
      aVista, parcelado, parceladoComJuros,
      ehPassaporte, etapaAtual, erro: msg,
    });
  };

  // ---------------- Passaporte: mantém o fluxo presencial já existente ----------------
  if (ehPassaporte) {
    const resultado = inscricaoSchema.safeParse(req.body);
    if (!resultado.success)
      return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);

    const { forma } = resultado.data;
    const formasValidas = ['PIX', 'CREDITO', 'DEBITO', 'DINHEIRO'];
    if (!formasValidas.includes(forma))
      return reRenderErro('Forma de pagamento inválida.');

    const valoresCalculados = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const total = Number(valoresCalculados.total); // já inclui taxa de matrícula

    try {
      const matricula = await criarOuRetomarMatricula(req.session.usuarioId, turma.id, {
        plano: 'A_VISTA',
        forma,
        valorCurso: total,
        valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
        statusPagamento: 'PENDENTE',
      });

      await prisma.pagamento.create({
        data: {
          matriculaId: matricula.id,
          tipo: 'CURSO',
          metodo: forma,
          valor: total,
          status: 'PENDENTE',
        },
      });
    } catch (err) {
      console.error('[Inscrição] Erro ao criar matrícula:', err.message);
      return reRenderErro('Não foi possível concluir a inscrição.');
    }

    return res.redirect('/minha-conta?inscrito=1');
  }

  // ---------------- CPF/CNPJ: passa pelo gateway Únicopag ----------------
  if (!aluno.cpfCnpj)
    return reRenderErro('CPF/CNPJ obrigatório para continuar. Complete seu cadastro em "Minha conta".');

  const plano = String(req.body.plano || '');
  if (!['A_VISTA', 'PARCELADO', 'PRESENCIAL'].includes(plano))
    return reRenderErro('Selecione o plano de pagamento.');

  // ----- A_VISTA: uma única transação (taxa + curso somados) -----
  if (plano === 'A_VISTA') {
    // 💡 v3 — o body não traz mais dados de cartão, então validamos só a forma.
    const forma = String(req.body.forma || '');
    if (!['PIX', 'CREDITO'].includes(forma))
      return reRenderErro('Selecione a forma de pagamento.');

    const valoresCalculados = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const total = Number(valoresCalculados.total); // curso + taxa

    let matricula;
    try {
      matricula = await criarOuRetomarMatricula(req.session.usuarioId, turma.id, {
        plano: 'A_VISTA',
        forma,
        valorCurso: total,
        valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
        statusPagamento: 'PENDENTE',
      });
    } catch (err) {
      console.error('[Inscrição] Erro ao criar matrícula:', err.message);
      return reRenderErro('Não foi possível concluir a inscrição.');
    }

    // 💡 v3 — CRÉDITO: nenhuma transação é criada aqui. O aluno preenche o
    // cartão na tela de retorno e ela chama POST /inscricao/cartao/:id.
    if (forma === 'CREDITO') {
      return res.redirect(urlRetorno(matricula.id, { pix: false, etapa: 'curso' }));
    }

    // ----- PIX: transação criada agora, QR Code na tela de retorno -----
    const pagamentoPendente = await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
        tipo: 'CURSO',
        gateway: 'unicopag',
        metodo: 'PIX',
        valor: total,
        status: 'PENDENTE',
      },
    });

    try {
      const resultadoGateway = await criarTransacao({
        matriculaId: matricula.id,
        nomeCurso: turma.curso.nome,
        valorTotal: total,
        forma: 'PIX',
        aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
        dadosCartao: null,
        tipoPagamento: 'CURSO',
      });

      const gatewayRef = String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash || matricula.id);

      await prisma.pagamento.update({
        where: { id: pagamentoPendente.id },
        data: {
          gatewayRef,
          gatewayHash: resultadoGateway.hash || null,
          gatewayStatus: resultadoGateway.paymentStatus || null,
          gatewayResponse: resultadoGateway,
          pixQrCode: resultadoGateway.pixQrCode || null,
          pixUrl: resultadoGateway.pixUrl || null,
          pixBase64: resultadoGateway.pixBase64 || null,
        },
      });

      return res.redirect(urlRetorno(matricula.id, { pix: true, etapa: 'curso' }));
    } catch (err) {
      console.error('[UnicopAg] Erro no Gateway (curso à vista):', err.message);

      // O gateway pode demorar e o nosso lado estourar timeout mesmo com a
      // transação já criada do lado deles. O webhook confirma por fora — damos
      // uma janela curta de espera antes de desistir e cancelar.
      let pagamentoAtual = null;
      for (let tentativa = 0; tentativa < 15; tentativa++) {
        pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
        if (pagamentoAtual?.gatewayRef) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (pagamentoAtual?.gatewayRef) {
        return res.redirect(urlRetorno(matricula.id, { pix: true, etapa: 'curso' }));
      }

      await prisma.pagamento.updateMany({
        where: { id: pagamentoPendente.id, status: 'PENDENTE' },
        data: { status: 'CANCELADO' },
      });
      return reRenderErro('Houve um problema ao processar o pagamento. Tente novamente.');
    }
  }

  // ----- PRESENCIAL: só cria a Matrícula agora. A taxa é paga em
  // /pagar-taxa (PIX ou Cartão, via gateway); o curso em si é pago
  // presencialmente na secretaria, sem gateway, em /pagar-curso. -----
  if (plano === 'PRESENCIAL') {
    const valoresCalculados = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const total = Number(valoresCalculados.total);

    try {
      await criarOuRetomarMatricula(req.session.usuarioId, turma.id, {
        plano: 'PRESENCIAL',
        forma: 'DINHEIRO', // forma real do curso é escolhida na secretaria; aqui é só placeholder
        valorCurso: total,
        valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
        statusPagamento: 'PENDENTE',
      });
    } catch (err) {
      console.error('[Inscrição] Erro ao criar matrícula (presencial):', err.message);
      return reRenderErro('Não foi possível concluir a inscrição.');
    }

    return res.redirect(`/inscrever/${turma.id}/pagar-taxa`);
  }

  // ----- PARCELADO: só cria a Matrícula agora. A taxa e o curso são pagos
  // em rotas separadas logo abaixo (/pagar-taxa e /pagar-curso). -----
  //
  // Matricula.forma exige um valor único mesmo havendo duas formas de
  // pagamento possíveis (taxa pode ser PIX ou Cartão; curso é sempre Cartão
  // parcelado) — fixamos 'CREDITO' aqui por ser o método que sempre paga o
  // curso (a parte principal do valor). A forma real de cada Pagamento fica
  // registrada individualmente em Pagamento.metodo.
  const valoresCalculados = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
  const total = Number(valoresCalculados.total);

  try {
    await criarOuRetomarMatricula(req.session.usuarioId, turma.id, {
      plano: 'PARCELADO',
      forma: 'CREDITO',
      valorCurso: total,
      valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
      statusPagamento: 'PENDENTE',
    });
  } catch (err) {
    console.error('[Inscrição] Erro ao criar matrícula (parcelado):', err.message);
    return reRenderErro('Não foi possível concluir a inscrição.');
  }

  return res.redirect(`/inscrever/${turma.id}/pagar-taxa`);
});

// ========================================================================
// PARCELADO / PRESENCIAL — Etapa 2: pagar a taxa de inscrição (PIX ou Cartão)
// ========================================================================

router.get('/inscrever/:turmaId/pagar-taxa', requireLogin, async (req, res) => {
  const matricula = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: req.params.turmaId } },
    include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
  });
  if (!matricula || !['PARCELADO', 'PRESENCIAL'].includes(matricula.plano))
    return res.status(404).render('erro', { mensagem: 'Inscrição não encontrada.' });

  if (matricula.taxaConfirmada)
    return res.redirect(`/inscrever/${req.params.turmaId}/pagar-curso`);

  const valores = await calcularValores(
    matricula.turma.curso,
    matricula.plano === 'PRESENCIAL' ? 'A_VISTA' : 'PARCELADO',
    req.session.usuarioId
  );
  const valorTaxa = Number(valores.valorTaxaMatricula);

  // Taxa isenta (ex.: modo POR_ALUNO e o aluno já pagou antes) — pula direto pro curso.
  if (valorTaxa <= 0) {
    await prisma.matricula.update({
      where: { id: matricula.id },
      data: { taxaConfirmada: true, taxaConfirmadaPor: 'sistema (isento)', taxaConfirmadaEm: new Date() },
    });
    return res.redirect(`/inscrever/${req.params.turmaId}/pagar-curso`);
  }

  res.render('inscrever', {
    turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
    valorTaxa, etapaAtual: 'pagar-taxa',
    erro: req.query.erro === 'expirado'
      ? 'O tempo para concluir o pagamento acabou. A cobrança foi cancelada — escolha a forma de novo.'
      : null,
  });
});

router.post('/inscrever/:turmaId/pagar-taxa', requireLogin, async (req, res) => {
  const matricula = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: req.params.turmaId } },
    include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
  });
  if (!matricula || !['PARCELADO', 'PRESENCIAL'].includes(matricula.plano))
    return res.status(404).render('erro', { mensagem: 'Inscrição não encontrada.' });
  if (matricula.taxaConfirmada)
    return res.redirect(`/inscrever/${req.params.turmaId}/pagar-curso`);

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: SELECT_ALUNO_CHECKOUT,
  });

  const valores = await calcularValores(
    matricula.turma.curso,
    matricula.plano === 'PRESENCIAL' ? 'A_VISTA' : 'PARCELADO',
    req.session.usuarioId
  );
  const valorTaxa = Number(valores.valorTaxaMatricula);

  const reRenderErro = (msg) => res.status(400).render('inscrever', {
    turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
    valorTaxa, etapaAtual: 'pagar-taxa', erro: msg,
  });

  const forma = String(req.body.forma || '');
  if (!['PIX', 'CREDITO'].includes(forma))
    return reRenderErro('Selecione a forma de pagamento.');

  // 💡 v3 — CRÉDITO: cartão é preenchido na tela de retorno.
  if (forma === 'CREDITO') {
    return res.redirect(urlRetorno(matricula.id, { pix: false, etapa: 'taxa' }));
  }

  // ----- PIX -----
  const pagamentoPendente = await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'TAXA',
      gateway: 'unicopag',
      metodo: 'PIX',
      valor: valorTaxa,
      status: 'PENDENTE',
    },
  });

  try {
    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: `Taxa de inscrição — ${matricula.turma.curso.nome}`,
      valorTotal: valorTaxa,
      forma: 'PIX',
      aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
      dadosCartao: null,
      tipoPagamento: 'TAXA',
    });

    const gatewayRef = String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash || matricula.id);

    await prisma.pagamento.update({
      where: { id: pagamentoPendente.id },
      data: {
        gatewayRef,
        gatewayHash: resultadoGateway.hash || null,
        gatewayStatus: resultadoGateway.paymentStatus || null,
        gatewayResponse: resultadoGateway,
        pixQrCode: resultadoGateway.pixQrCode || null,
        pixUrl: resultadoGateway.pixUrl || null,
        pixBase64: resultadoGateway.pixBase64 || null,
      },
    });

    return res.redirect(urlRetorno(matricula.id, { pix: true, etapa: 'taxa' }));
  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway (taxa):', err.message);

    let pagamentoAtual = null;
    for (let tentativa = 0; tentativa < 15; tentativa++) {
      pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
      if (pagamentoAtual?.gatewayRef) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (pagamentoAtual?.gatewayRef) {
      return res.redirect(urlRetorno(matricula.id, { pix: true, etapa: 'taxa' }));
    }

    await prisma.pagamento.updateMany({
      where: { id: pagamentoPendente.id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
    return reRenderErro('Houve um problema ao processar o pagamento da taxa. Tente novamente.');
  }
});

// ========================================================================
// PARCELADO — Etapa 3: pagar o curso (sempre Cartão de crédito, com juros)
// PRESENCIAL — Etapa 3: apenas confirma a inscrição; o curso é pago na
//   secretaria depois, sem gateway.
// ========================================================================
// Só é acessível depois que a taxa foi confirmada pelo webhook.

router.get('/inscrever/:turmaId/pagar-curso', requireLogin, async (req, res) => {
  const matricula = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: req.params.turmaId } },
    include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
  });
  if (!matricula || !['PARCELADO', 'PRESENCIAL'].includes(matricula.plano))
    return res.status(404).render('erro', { mensagem: 'Inscrição não encontrada.' });
  if (!matricula.taxaConfirmada)
    return res.redirect(`/inscrever/${req.params.turmaId}/pagar-taxa`);
  if (['PAGO', 'PARCELADO', 'CANCELADO', 'ESTORNADO'].includes(matricula.statusPagamento))
    return res.render('erro', { mensagem: 'O pagamento deste curso já foi processado. Veja em "Minha conta".' });

  const erroQuery = req.query.erro === 'expirado'
    ? 'O tempo para concluir o pagamento acabou. A cobrança foi cancelada — você pode tentar de novo.'
    : null;

  // ---------------- PRESENCIAL: só mostra a tela de confirmação ----------------
  if (matricula.plano === 'PRESENCIAL') {
    const valores = await calcularValores(matricula.turma.curso, 'A_VISTA', req.session.usuarioId);
    return res.render('inscrever', {
      turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
      valorCurso: Number(valores.valorCurso), numParcelas: 1, parceladoComJuros: null,
      plano: matricula.plano,
      etapaAtual: 'pagar-curso', erro: erroQuery,
    });
  }

  // ---------------- PARCELADO: resumo + botão que leva à tela do cartão ------
  // Aqui o parcelamento incide só sobre o curso (a taxa já foi paga na etapa 2),
  // então parceladoComJuros.total é só o curso COM juros — sem taxa por fora.
  const valores = await calcularValores(matricula.turma.curso, 'PARCELADO', req.session.usuarioId);
  const numParcelas = Number(matricula.turma.curso.parcelas) || 1;
  const amountCentavos = Math.round(parseFloat(valores.valorCurso) * 100);
  const opcao = await obterOpcaoParcelamento(amountCentavos, numParcelas);
  const parceladoComJuros = opcao ? {
    valorParcela: opcao.installment_amount / 100,
    total: opcao.total_amount / 100,
    taxaJuros: opcao.installment_rate,
  } : null;

  res.render('inscrever', {
    turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
    valorCurso: Number(valores.valorCurso), numParcelas, parceladoComJuros,
    plano: matricula.plano,
    etapaAtual: 'pagar-curso', erro: erroQuery,
  });
});

router.post('/inscrever/:turmaId/pagar-curso', requireLogin, async (req, res) => {
  const matricula = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: req.params.turmaId } },
    include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
  });
  if (!matricula || !['PARCELADO', 'PRESENCIAL'].includes(matricula.plano))
    return res.status(404).render('erro', { mensagem: 'Inscrição não encontrada.' });
  if (!matricula.taxaConfirmada)
    return res.redirect(`/inscrever/${req.params.turmaId}/pagar-taxa`);
  if (['PAGO', 'PARCELADO', 'CANCELADO', 'ESTORNADO'].includes(matricula.statusPagamento))
    return res.render('erro', { mensagem: 'O pagamento deste curso já foi processado. Veja em "Minha conta".' });

  // ---------------- PRESENCIAL: sem gateway — só registra o Pagamento pendente
  // e confirma a inscrição. O valor será cobrado na secretaria. ----------------
  if (matricula.plano === 'PRESENCIAL') {
    const valores = await calcularValores(matricula.turma.curso, 'A_VISTA', req.session.usuarioId);
    try {
      await prisma.pagamento.create({
        data: {
          matriculaId: matricula.id,
          tipo: 'CURSO',
          metodo: 'DINHEIRO', // forma real é escolhida na secretaria
          valor: Number(valores.valorCurso),
          status: 'PENDENTE',
        },
      });
    } catch (err) {
      console.error('[Inscrição] Erro ao registrar pagamento presencial:', err.message);
      return res.status(400).render('inscrever', {
        turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
        valorCurso: Number(valores.valorCurso), numParcelas: 1, parceladoComJuros: null,
        plano: matricula.plano, etapaAtual: 'pagar-curso',
        erro: 'Não foi possível confirmar a inscrição. Tente novamente.',
      });
    }
    return res.redirect('/minha-conta?inscrito=1');
  }

  // ---------------- PARCELADO: cartão preenchido na tela de retorno ----------
  // 💡 v3 — este POST não fala mais com o gateway. Ele só encaminha para a
  // tela do cartão, que chama POST /inscricao/cartao/:matriculaId.
  return res.redirect(urlRetorno(matricula.id, { pix: false, etapa: 'curso' }));
});

// ========================================================================
// Tela de retorno — QR Code (PIX) ou formulário de cartão
// ========================================================================

router.get('/inscricao/retorno', requireLogin, async (req, res) => {
  const { matriculaId, pix, etapa, t } = req.query;

  // findFirst com alunoId: o aluno só enxerga o retorno (e o QR Code) da
  // própria matrícula, mesmo que outro ID seja chutado na query string.
  const matricula = matriculaId
    ? await prisma.matricula.findFirst({
        where: { id: matriculaId, alunoId: req.session.usuarioId },
        include: {
          turma: { include: { curso: true } },
          pagamentos: { orderBy: { criadoEm: 'desc' }, take: 1 },
        },
      })
    : null;

  const isPix = pix === '1';
  const etapaAtual = etapa === 'taxa' ? 'taxa' : 'curso';

  // ---------------- PIX: view de sempre ----------------
  if (isPix || !matricula) {
    const pagamento = matricula?.pagamentos?.[0] || null;
    return res.render('inscricao-retorno', {
      matricula,
      formatBRL,
      isPix,
      etapa: etapaAtual,
      transacaoRef: String(t || matricula?.id || ''),
      pixQrCode: pagamento?.pixQrCode || null,
      pixUrl: pagamento?.pixUrl || null,
      pixBase64: pagamento?.pixBase64 || null,
    });
  }

  // ---------------- CARTÃO: tela dedicada ----------------
  // Se já está tudo pago, não faz sentido reabrir a cobrança.
  if (etapaAtual === 'taxa' && matricula.taxaConfirmada)
    return res.redirect(`/inscrever/${matricula.turmaId}/pagar-curso`);
  if (etapaAtual === 'curso' && ['PAGO', 'PARCELADO'].includes(matricula.statusPagamento))
    return res.redirect('/minha-conta?inscrito=1');

  const { valorCobranca, numParcelas, valorParcela } =
    await calcularCobrancaCartao(matricula, etapaAtual, req.session.usuarioId);

    res.render('inscricao-retorno', {
      matricula,
      turma: matricula.turma,
      curso: matricula.turma.curso,
      formatBRL,
      isPix: false,
      etapa: etapaAtual,
      valorCobranca,
      numParcelas,
      valorParcela,
      transacaoRef: String(t || matricula.id),
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Quanto cobrar no cartão, por etapa. É a fonte da verdade — o front nunca
// manda valor, só os dados do cartão.
//   taxa                    → taxa de inscrição, 1x
//   curso + plano PARCELADO → curso em N parcelas (juros do gateway)
//   curso + plano A_VISTA   → curso + taxa, 1x
// ─────────────────────────────────────────────────────────────────────────
async function calcularCobrancaCartao(matricula, etapa, alunoId) {
  const curso = matricula.turma.curso;

  if (etapa === 'taxa') {
    const valores = await calcularValores(
      curso, matricula.plano === 'PRESENCIAL' ? 'A_VISTA' : 'PARCELADO', alunoId
    );
    const taxa = Number(valores.valorTaxaMatricula);
    return { valorCobranca: taxa, valorBase: taxa, numParcelas: 1, valorParcela: null, tipo: 'TAXA' };
  }

  if (matricula.plano === 'PARCELADO') {
    const valores = await calcularValores(curso, 'PARCELADO', alunoId);
    const numParcelas = Number(curso.parcelas) || 1;
    const amountCentavos = Math.round(parseFloat(valores.valorCurso) * 100);
    const opcao = await obterOpcaoParcelamento(amountCentavos, numParcelas);
    // valorBase = SEM juros. Vai pro gateway (que aplica o juro a partir de
    // amount + installments) e é o que gravamos em Pagamento.valor, porque o
    // postback ecoa o amount BASE — o matching do webhook casa por esse valor.
    const valorBase = Number(valores.valorCurso);
    return {
      valorCobranca: opcao ? opcao.total_amount / 100 : valorBase, // com juros, só pra exibir
      valorBase,
      numParcelas,
      valorParcela: opcao ? opcao.installment_amount / 100 : valorBase,
      taxa: Number(valores.valorTaxaMatricula),
      tipo: 'CURSO',
    };
  }

  // A_VISTA no cartão: curso + taxa numa cobrança só.
  const valores = await calcularValores(curso, 'A_VISTA', alunoId);
  const total = Number(valores.total);
  return { valorCobranca: total, valorBase: total, numParcelas: 1, valorParcela: null, tipo: 'CURSO' };
}

// ========================================================================
// 💡 NOVO (v3) — Cobrança no cartão. Chamada por fetch pela tela de retorno.
// Responde JSON: { ok, status, mensagem }
//   status: 'PROCESSANDO' (webhook confirma) | ausente em caso de erro
// ========================================================================

router.post('/inscricao/cartao/:matriculaId', requireLogin, async (req, res) => {
  const matricula = await prisma.matricula.findFirst({
    where: { id: req.params.matriculaId, alunoId: req.session.usuarioId },
    include: { turma: { include: { curso: true } } },
  });
  if (!matricula)
    return res.status(404).json({ ok: false, mensagem: 'Inscrição não encontrada.' });

  const etapa = req.body.etapa === 'taxa' ? 'taxa' : 'curso';

  // Já confirmado no meio do caminho (webhook rápido, duplo clique): não cobra de novo.
  if (etapa === 'taxa' && matricula.taxaConfirmada)
    return res.json({ ok: true, status: 'PAGO' });
  if (etapa === 'curso' && ['PAGO', 'PARCELADO'].includes(matricula.statusPagamento))
    return res.json({ ok: true, status: 'PAGO' });
  if (etapa === 'curso' && !matricula.taxaConfirmada && matricula.plano === 'PARCELADO')
    return res.status(400).json({ ok: false, mensagem: 'A taxa de inscrição ainda não foi confirmada.' });

  const cobranca = await calcularCobrancaCartao(matricula, etapa, req.session.usuarioId);

  // Validação dos dados do cartão — mesmos schemas de sempre, só que agora o
  // plano/forma/parcelas vêm do servidor, não do body.
  const schema = etapa === 'taxa' ? pagamentoTaxaSchema : pagamentoCursoSchema;
  const resultado = schema.safeParse({
    ...req.body,
    forma: 'CREDITO',
    plano: matricula.plano,
    parcelas: cobranca.numParcelas,
  });
  if (!resultado.success)
    return res.status(400).json({ ok: false, mensagem: resultado.error.issues.map((i) => i.message)[0] });

  const { numero, titular, validade, cvv } = resultado.data;
  const [mes, anoCurto] = String(validade).split('/');
  const mesExpiracao = mes;
  const anoExpiracao = '20' + anoCurto;

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: SELECT_ALUNO_CHECKOUT,
  });

  const pagamentoPendente = await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id,
      tipo: cobranca.tipo,
      gateway: 'unicopag',
      metodo: 'CREDITO',
      valor: cobranca.valorBase, // valor BASE — casa com o amount do postback
      status: 'PENDENTE',
    },
  });

  // No parcelado, a matrícula guarda o total COM juros só pra exibição em
  // "Minha conta" (curso c/ juros + taxa à vista). Pagamento.valor segue base.
  if (etapa === 'curso' && matricula.plano === 'PARCELADO') {
    await prisma.matricula.update({
      where: { id: matricula.id },
      data: { valorCurso: cobranca.valorCobranca + Number(cobranca.taxa || 0) },
    });
  }

  try {
    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: etapa === 'taxa'
        ? `Taxa de inscrição — ${matricula.turma.curso.nome}`
        : matricula.turma.curso.nome,
      valorTotal: cobranca.valorBase, // o gateway aplica o juro do parcelamento
      forma: 'CREDITO',
      aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
      dadosCartao: { numero, titular, mesExpiracao, anoExpiracao, cvv, parcelas: cobranca.numParcelas },
      tipoPagamento: cobranca.tipo,
    });

    const gatewayRef = String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash || matricula.id);

    await prisma.pagamento.update({
      where: { id: pagamentoPendente.id },
      data: {
        gatewayRef,
        gatewayHash: resultadoGateway.hash || null,
        gatewayStatus: resultadoGateway.paymentStatus || null,
        gatewayResponse: resultadoGateway,
      },
    });

    // Quem confirma de verdade é o webhook. A tela fica em polling no
    // /inscricao/status até virar PAGO.
    return res.json({ ok: true, status: 'PROCESSANDO' });
  } catch (err) {
    // Nunca logar req.body aqui — tem número de cartão dentro.
    console.error(`[UnicopAg] Erro no Gateway (cartão ${etapa}):`, err.message);
    await prisma.pagamento.updateMany({
      where: { id: pagamentoPendente.id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
    return res.status(502).json({
      ok: false,
      mensagem: 'Não conseguimos processar essa cobrança. Confira os dados ou tente outro cartão.',
    });
  }
});

// ========================================================================
// 💡 NOVO (v3) — Cancelar a transação em aberto (tempo esgotado na tela)
// ========================================================================
// Cancela só os Pagamentos PENDENTES. A Matrícula continua PENDENTE de
// propósito: assim ela segue sendo "fantasma" e a pessoa pode refazer o fluxo
// do zero. Marcar a matrícula como CANCELADA a tiraria dessa condição e
// travaria novas inscrições nessa turma para sempre.
router.post('/inscricao/cancelar-transacao/:matriculaId', requireLogin, async (req, res) => {
  const matricula = await prisma.matricula.findFirst({
    where: { id: req.params.matriculaId, alunoId: req.session.usuarioId },
    select: { id: true, statusPagamento: true, taxaConfirmada: true },
  });
  if (!matricula) return res.status(404).json({ ok: false });

  // Confirmou no último segundo? Não cancela nada.
  if (['PAGO', 'PARCELADO'].includes(matricula.statusPagamento))
    return res.json({ ok: true, jaPago: true });

  try {
    await prisma.pagamento.updateMany({
      where: { matriculaId: matricula.id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
  } catch (err) {
    console.error('[Inscrição] Erro ao cancelar transação:', err.message);
  }

  res.json({ ok: true });
});

// Status da matrícula — consultado via polling pelas telas de retorno.
// Quando o webhook confirma a TAXA, o front redireciona o aluno pra etapa 3
// sozinho; quando confirma o CURSO (ou, no caso PRESENCIAL, quando o aluno
// finaliza a etapa 3 direto), manda pra "Minha conta".
router.get('/inscricao/status/:matriculaId', requireLogin, async (req, res) => {
  const m = await prisma.matricula.findFirst({
    where: { id: req.params.matriculaId, alunoId: req.session.usuarioId },
    select: { taxaConfirmada: true, statusPagamento: true, turmaId: true, plano: true },
  });
  if (!m) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...m });
});

module.exports = router;  