const express = require('express');
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { inscricaoSchema } = require('../lib/validation');
const {
  calcularValores,
  formatBRL,
  lerConfigMatricula,
  totalExibicao,
} = require('../lib/matricula');
const { criarTransacao, obterOpcaoParcelamento } = require('../lib/unicopag');

const router = express.Router();

router.get('/', async (req, res) => {
  const [cursos, cfgMap, total] = await Promise.all([
    prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, take: 3 }),
    lerConfigMatricula(),
    prisma.curso.count({ where: { ativo: true } }),
  ]);
  res.render('home', { cursos, cfgMap, temMais: total > cursos.length, formatBRL, totalExibicao });
});

router.get('/sobre', (req, res) => res.render('sobre'));
router.get('/seguranca', (req, res) => res.render('seguranca'));

router.get('/cursos', async (req, res) => {
  const [cursos, cfgMap] = await Promise.all([
    prisma.curso.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      include: { turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 } },
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
        turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' } },
        faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] },
      },
    }),
    lerConfigMatricula(),
  ]);
  if (!curso || !curso.ativo) return res.status(404).render('erro', { mensagem: 'Curso não encontrado.' });
  const outros = await prisma.curso.findMany({
    where: { ativo: true, id: { not: curso.id } },
    orderBy: { nome: 'asc' },
    take: 3,
    include: { turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 } },
  });
  res.render('curso-detalhe', { curso, outros, formatBRL, total: totalExibicao(curso, cfgMap), totalExibicao, cfgMap });
});

router.get('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true },
  });
  if (!turma || turma.status !== 'ABERTA') return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });
  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito) return res.render('erro', { mensagem: 'Você já está inscrito nesta turma. Veja em "Minha conta".' });
  const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
  const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);

  // Consulta o juros real do cartão de crédito para o número de parcelas do curso,
  // para exibir ao aluno o valor final ANTES dele confirmar (evita surpresa no cartão).
  // Se a consulta falhar, cai de volta pro valor sem juros (comportamento antigo).
  const numParcelas = Number(turma.curso.parcelas) || 1;
  let parceladoComJuros = null;
  if (numParcelas > 1) {
    const amountCentavos = Math.round(parseFloat(parcelado.total) * 100);
    const opcao = await obterOpcaoParcelamento(amountCentavos, numParcelas);
    if (opcao) {
      parceladoComJuros = {
        valorParcela: opcao.installment_amount / 100,
        total: opcao.total_amount / 100,
        taxaJuros: opcao.installment_rate,
      };
    }
  }

  res.render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, parceladoComJuros, erro: null });
});

router.post('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true },
  });
  if (!turma || turma.status !== 'ABERTA') return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });

  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito) return res.redirect('/minha-conta?jaInscrito=1');

  const reRenderErro = async (msg) => {
    const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);

    const numParcelas = Number(turma.curso.parcelas) || 1;
    let parceladoComJuros = null;
    if (numParcelas > 1) {
      const amountCentavos = Math.round(parseFloat(parcelado.total) * 100);
      const opcao = await obterOpcaoParcelamento(amountCentavos, numParcelas);
      if (opcao) {
        parceladoComJuros = {
          valorParcela: opcao.installment_amount / 100,
          total: opcao.total_amount / 100,
          taxaJuros: opcao.installment_rate,
        };
      }
    }

    return res.status(400).render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, parceladoComJuros, erro: msg });
  };

  const resultado = inscricaoSchema.safeParse(req.body);
  if (!resultado.success) return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);

  const { plano, forma, numero, titular, validade, cvv } = resultado.data;
  const usaGateway = forma !== 'DINHEIRO';

  let mesExpiracao, anoExpiracao;
  if (forma === 'CREDITO' && validade) {
    const [mes, anoCurto] = validade.split('/');
    mesExpiracao = mes;
    anoExpiracao = '20' + anoCurto;
  }

  const total = plano === 'A_VISTA' ? Number(turma.curso.precoAvista) : Number(turma.curso.precoCheio);

  let matricula;
  try {
    matricula = await prisma.matricula.create({
      data: { 
        alunoId: req.session.usuarioId, 
        turmaId: turma.id, 
        plano, 
        forma, 
        valorCurso: total,
        statusPagamento: 'PENDENTE' 
      },
    });
  } catch (err) {
    return reRenderErro('Não foi possível concluir a inscrição.');
  }

  if (!usaGateway) return res.redirect('/minha-conta?inscrito=1');

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { nome: true, email: true, cpfCnpj: true, celular: true, cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true },
  });

  if (!aluno?.cpfCnpj) return res.render('erro', { mensagem: 'CPF obrigatório.' });

  const pagamentoPendente = await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id,
      gateway: 'unicopag',
      gatewayRef: null,
      metodo: forma,
      valor: total,
      status: 'PENDENTE',
    },
  });

  try {
    const parcelasFinais = plano === 'PARCELADO' ? Number(turma.curso.parcelas || 1) : 1;

    // Busca o valor total com juros do gateway antes de criar a transação.
    // Sem isso, o gateway aplica os juros por cima do valor original,
    // resultando em um valor incorreto cobrado do aluno.
    let valorFinal = total;
    if (forma === 'CREDITO' && parcelasFinais > 1) {
      const amountCentavos = Math.round(parseFloat(total) * 100);
      const opcao = await obterOpcaoParcelamento(amountCentavos, parcelasFinais);
      if (opcao) {
        valorFinal = opcao.total_amount / 100; // total já com juros, em reais
        console.log(`[PARCELAMENTO] ${parcelasFinais}x | valor original: R$${total} | valor com juros (${opcao.installment_rate}%): R$${valorFinal}`);
      } else {
        console.warn(`[PARCELAMENTO] Não foi possível obter juros para ${parcelasFinais}x, usando valor original.`);
      }
    }

    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: turma.curso.nome,
      valorTotal: valorFinal,
      forma,
      aluno: {
        ...aluno,
        cidade: aluno.cidade || "Rio de Janeiro"
      },
      dadosCartao: forma === 'CREDITO' ? { 
        numero, 
        titular, 
        mesExpiracao, 
        anoExpiracao, 
        cvv, 
        parcelas: parcelasFinais 
      } : null
    });

    const gatewayRef = String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash || matricula.id);

    await prisma.pagamento.update({
      where: { id: pagamentoPendente.id },
      data: {
        gateway: 'unicopag',
        gatewayRef,
        gatewayHash: resultadoGateway.hash || null,
        gatewayStatus: resultadoGateway.paymentStatus || resultadoGateway.status || null,
        gatewayResponse: resultadoGateway,

        pixQrCode: resultadoGateway.pixQrCode || null,
        pixUrl: resultadoGateway.pixUrl || null,
        pixBase64: resultadoGateway.pixBase64 || null,
      },
    });

    if (resultadoGateway.checkoutUrl) {
      return res.redirect(resultadoGateway.checkoutUrl);
    }

    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=${forma === 'PIX' ? '1' : '0'}`);

  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway:', err.message);

    if (forma === 'PIX') {
      let pagamentoAtual = null;
      for (let tentativa = 0; tentativa < 15; tentativa++) {
        pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
        if (pagamentoAtual?.gatewayRef) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (pagamentoAtual?.gatewayRef) {
        console.log(`[UnicopAg] Pix ${pagamentoAtual.gatewayRef} confirmado pelo webhook durante a espera.`);
        return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=1`);
      }
    }

    await prisma.pagamento.updateMany({
      where: { id: pagamentoPendente.id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
    return res.render('erro', { mensagem: 'Houve um problema ao processar o pagamento. Tente novamente.' });
  }
});

router.get('/inscricao/retorno', requireLogin, async (req, res) => {
  const { matriculaId, pix } = req.query;

  const matricula = matriculaId
    ? await prisma.matricula.findUnique({
        where: { id: matriculaId },
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
    pixQrCode: pagamento?.pixQrCode || null,
    pixUrl: pagamento?.pixUrl || null,
    pixBase64: pagamento?.pixBase64 || null,
  });
});

module.exports = router;