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
// Pagamento da taxa se vincular) mas onde a pessoa nunca chegou a pagar nada:
// statusPagamento ainda no estado inicial PENDENTE E taxaConfirmada false.
// Ela fica escondida em "Minha conta" (ver conta.js), mas SEM esta função o
// findUnique de "já inscrito" abaixo ainda a encontraria e bloquearia a
// pessoa com um erro genérico mandando "ver em Minha conta" — onde não tem
// nada pra ver. Em vez de bloquear, tratamos como "retomar de onde parou".
function ehMatriculaFantasma(m) {
  return !!m && m.statusPagamento === 'PENDENTE' && m.taxaConfirmada === false;
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
    prisma.curso.findMany({ where: filtro, orderBy: { nome: 'asc' }, take: 3 }),
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
// CPF/CNPJ + PARCELADO   → matrícula criada sem Pagamento ainda; o aluno paga
//   a taxa em /pagar-taxa e, só depois de confirmada, o curso parcelado
//   (cartão, via gateway) em /pagar-curso.
// CPF/CNPJ + PRESENCIAL  → matrícula criada sem Pagamento ainda; o aluno paga
//   a taxa em /pagar-taxa (PIX ou Cartão, via gateway) e o curso é pago
//   depois presencialmente na secretaria (sem gateway) em /pagar-curso.

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
  if (jaInscrito)
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
    erro: null,
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
  if (jaInscrito) return res.redirect('/minha-conta?jaInscrito=1');

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
      const matricula = await prisma.matricula.create({
        data: {
          alunoId: req.session.usuarioId,
          turmaId: turma.id,
          plano: 'A_VISTA',
          forma,
          valorCurso: total,
          valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
          statusPagamento: 'PENDENTE',
        },
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
    const resultado = pagamentoCursoSchema.safeParse({ ...req.body, plano: 'A_VISTA' });
    if (!resultado.success)
      return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);

    const { forma, numero, titular, validade, cvv } = resultado.data;

    let mesExpiracao, anoExpiracao;
    if (forma === 'CREDITO' && validade) {
      const [mes, anoCurto] = validade.split('/');
      mesExpiracao = mes;
      anoExpiracao = '20' + anoCurto;
    }

    const valoresCalculados = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const total = Number(valoresCalculados.total); // curso + taxa

    let matricula;
    try {
      matricula = await prisma.matricula.create({
        data: {
          alunoId: req.session.usuarioId,
          turmaId: turma.id,
          plano: 'A_VISTA',
          forma,
          valorCurso: total,
          valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
          statusPagamento: 'PENDENTE',
        },
      });
    } catch (err) {
      console.error('[Inscrição] Erro ao criar matrícula:', err.message);
      return reRenderErro('Não foi possível concluir a inscrição.');
    }

    const pagamentoPendente = await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
        tipo: 'CURSO',
        gateway: 'unicopag',
        metodo: forma,
        valor: total,
        status: 'PENDENTE',
      },
    });

    try {
      const resultadoGateway = await criarTransacao({
        matriculaId: matricula.id,
        nomeCurso: turma.curso.nome,
        valorTotal: total,
        forma,
        aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
        dadosCartao: forma === 'CREDITO' ? { numero, titular, mesExpiracao, anoExpiracao, cvv, parcelas: 1 } : null,
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

      return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=${forma === 'PIX' ? '1' : '0'}`);
    } catch (err) {
      console.error('[UnicopAg] Erro no Gateway (curso à vista):', err.message);

      // PIX: o gateway pode demorar e o nosso lado estourar timeout mesmo com a
      // transação já criada do lado deles. O webhook confirma por fora — damos
      // uma janela curta de espera antes de desistir e cancelar.
      if (forma === 'PIX') {
        let pagamentoAtual = null;
        for (let tentativa = 0; tentativa < 15; tentativa++) {
          pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
          if (pagamentoAtual?.gatewayRef) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        if (pagamentoAtual?.gatewayRef) {
          return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=1`);
        }
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

    let matricula;
    try {
      matricula = await prisma.matricula.create({
        data: {
          alunoId: req.session.usuarioId,
          turmaId: turma.id,
          plano: 'PRESENCIAL',
          forma: 'DINHEIRO', // forma real do curso é escolhida na secretaria; aqui é só placeholder
          valorCurso: total,
          valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
          statusPagamento: 'PENDENTE',
        },
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

  let matricula;
  try {
    matricula = await prisma.matricula.create({
      data: {
        alunoId: req.session.usuarioId,
        turmaId: turma.id,
        plano: 'PARCELADO',
        forma: 'CREDITO',
        valorCurso: total,
        valorTaxaMatricula: valoresCalculados.valorTaxaMatricula,
        statusPagamento: 'PENDENTE',
      },
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
    valorTaxa, etapaAtual: 'pagar-taxa', erro: null,
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

  const resultado = pagamentoTaxaSchema.safeParse(req.body);
  if (!resultado.success)
    return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);

  const { forma, numero, titular, validade, cvv } = resultado.data;

  let mesExpiracao, anoExpiracao;
  if (forma === 'CREDITO' && validade) {
    const [mes, anoCurto] = validade.split('/');
    mesExpiracao = mes;
    anoExpiracao = '20' + anoCurto;
  }

  const pagamentoPendente = await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'TAXA',
      gateway: 'unicopag',
      metodo: forma,
      valor: valorTaxa,
      status: 'PENDENTE',
    },
  });

  try {
    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: `Taxa de inscrição — ${matricula.turma.curso.nome}`,
      valorTotal: valorTaxa,
      forma,
      aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
      dadosCartao: forma === 'CREDITO' ? { numero, titular, mesExpiracao, anoExpiracao, cvv, parcelas: 1 } : null,
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

    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=${forma === 'PIX' ? '1' : '0'}&etapa=taxa`);
  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway (taxa):', err.message);

    if (forma === 'PIX') {
      let pagamentoAtual = null;
      for (let tentativa = 0; tentativa < 15; tentativa++) {
        pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
        if (pagamentoAtual?.gatewayRef) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (pagamentoAtual?.gatewayRef) {
        return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=1&etapa=taxa`);
      }
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

  // ---------------- PRESENCIAL: só mostra a tela de confirmação ----------------
  if (matricula.plano === 'PRESENCIAL') {
    const valores = await calcularValores(matricula.turma.curso, 'A_VISTA', req.session.usuarioId);
    return res.render('inscrever', {
      turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
      valorCurso: Number(valores.valorCurso), numParcelas: 1, parceladoComJuros: null,
      plano: matricula.plano,
      etapaAtual: 'pagar-curso', erro: null,
    });
  }

  // ---------------- PARCELADO: formulário de cartão parcelado ----------------
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
    etapaAtual: 'pagar-curso', erro: null,
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

  // ---------------- PARCELADO: cartão parcelado via gateway ----------------
  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: SELECT_ALUNO_CHECKOUT,
  });

  const valores = await calcularValores(matricula.turma.curso, 'PARCELADO', req.session.usuarioId);
  const numParcelasCurso = Number(matricula.turma.curso.parcelas) || 1;

  const reRenderErro = async (msg) => {
    const amountCentavos = Math.round(parseFloat(valores.valorCurso) * 100);
    const opcao = await obterOpcaoParcelamento(amountCentavos, numParcelasCurso);
    const parceladoComJuros = opcao ? {
      valorParcela: opcao.installment_amount / 100,
      total: opcao.total_amount / 100,
      taxaJuros: opcao.installment_rate,
    } : null;
    return res.status(400).render('inscrever', {
      turma: matricula.turma, curso: matricula.turma.curso, formatBRL,
      valorCurso: Number(valores.valorCurso), numParcelas: numParcelasCurso, parceladoComJuros,
      plano: matricula.plano,
      etapaAtual: 'pagar-curso', erro: msg,
    });
  };

  // O curso parcelado é sempre Cartão de crédito — forçamos aqui independente
  // do que vier no body, e reaproveitamos a validação de cartão do schema.
  const resultado = pagamentoCursoSchema.safeParse({ ...req.body, plano: 'PARCELADO', forma: 'CREDITO' });
  if (!resultado.success)
    return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);

  const { numero, titular, validade, cvv, parcelas } = resultado.data;
  const [mes, anoCurto] = validade.split('/');
  const mesExpiracao = mes;
  const anoExpiracao = '20' + anoCurto;

  const amountCentavos = Math.round(parseFloat(valores.valorCurso) * 100);
  const opcao = await obterOpcaoParcelamento(amountCentavos, parcelas);
  // valorFinal = valor do curso COM juros de parcelamento (o que o aluno paga).
  // Se a consulta de juros falhar, cai de volta pro valor sem juros.
  const valorFinal = opcao ? opcao.total_amount / 100 : Number(valores.valorCurso);
  // valorBase = valor SEM juros. Vai pro gateway (que aplica o juro a partir de
  // amount + installments — mandar valorFinal causaria juro dobrado) E é o que
  // gravamos em Pagamento.valor, porque o postback ecoa o amount BASE (10, não
  // 10,37). O matching do webhook por e-mail casa por Pagamento.valor === amount
  // do postback; se gravássemos valorFinal aqui, nunca casaria e a matrícula
  // ficaria PENDENTE pra sempre mesmo com o curso pago.
  const valorBase = Number(valores.valorCurso);
  const taxa = Number(valores.valorTaxaMatricula);

  const pagamentoPendente = await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id,
      tipo: 'CURSO',
      gateway: 'unicopag',
      metodo: 'CREDITO',
      valor: valorBase, // valor BASE — casa com o amount do postback (matching por valor)
      status: 'PENDENTE',
    },
  });

  // Atualiza o total exibido na matrícula pro valor COM juros (curso c/ juros +
  // taxa à vista). Assim o card em "Minha conta" mostra R$20,37 em vez do R$20
  // base. Pagamento.valor segue base (pro matching); a matrícula guarda o total
  // que o aluno realmente paga, pra exibição.
  await prisma.matricula.update({
    where: { id: matricula.id },
    data: { valorCurso: valorFinal + taxa },
  });

  try {
    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: matricula.turma.curso.nome,
      valorTotal: valorBase, // 💡 valor BASE — o gateway aplica o juro do parcelamento
      forma: 'CREDITO',
      aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
      dadosCartao: { numero, titular, mesExpiracao, anoExpiracao, cvv, parcelas },
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
      },
    });

    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=0&etapa=curso`);
  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway (curso parcelado):', err.message);
    await prisma.pagamento.updateMany({
      where: { id: pagamentoPendente.id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
    return reRenderErro('Houve um problema ao processar o pagamento do curso. Tente novamente.');
  }
});

// ========================================================================
// Tela de retorno — mostra QR/status do pagamento mais recente
// ========================================================================

router.get('/inscricao/retorno', requireLogin, async (req, res) => {
  const { matriculaId, pix, etapa } = req.query;

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

  const pagamento = matricula?.pagamentos?.[0] || null;

  res.render('inscricao-retorno', {
    matricula,
    formatBRL,
    isPix: pix === '1',
    etapa: etapa || 'curso',
    pixQrCode: pagamento?.pixQrCode || null,
    pixUrl: pagamento?.pixUrl || null,
    pixBase64: pagamento?.pixBase64 || null,
  });
});

// NOVO: status da matrícula — consultado via polling pela tela de retorno.
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