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
const { criarTransacao } = require('../lib/unicopag');

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
  res.render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: null });
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
    return res.status(400).render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: msg });
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

    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: turma.curso.nome,
      valorTotal: total,
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

    // 💡 CORRIGIDO: trocado de updateMany({ where: { id, status: 'PENDENTE' } }) para
    // update({ where: { id } }) simples. Para Pix, o webhook da Únicopag pode chegar e já
    // mudar o status do Pagamento de PENDENTE para PAGO ANTES desta linha rodar (a criação
    // da transação no gateway deles dispara o webhook quase em paralelo com a resposta HTTP
    // que estamos esperando aqui). Quando isso acontecia, o updateMany não encontrava
    // nenhuma linha com status ainda PENDENTE, então rodava com 0 linhas afetadas — sem
    // erro nenhum — e o pixQrCode/pixUrl/pixBase64 nunca eram gravados no banco, mesmo o
    // gateway tendo retornado o QR Code certinho (por isso aparecia no log mas não na tela
    // de retorno, que lê esses campos do banco). Usando update() pelo id, a gravação
    // acontece independente do status atual do pagamento.
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

    // Redireciona para a página de retorno — os dados do Pix serão lidos do banco lá
    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=${forma === 'PIX' ? '1' : '0'}`);

  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway:', err.message);

    if (forma === 'PIX') {
      // Fallback: se o gateway estourou timeout mas o webhook pode ter chegado,
      // aguarda até 30s checando se o gatewayRef foi gravado pelo webhook.
      let pagamentoAtual = null;
      for (let tentativa = 0; tentativa < 15; tentativa++) {
        pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
        if (pagamentoAtual?.gatewayRef) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (pagamentoAtual?.gatewayRef) {
        console.log(`[UnicopAg] Pix ${pagamentoAtual.gatewayRef} confirmado pelo webhook durante a espera.`);
        // Tenta redirecionar para retorno mesmo sem QR (webhook não traz QR code)
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
          // Busca o pagamento mais recente para pegar pixQrCode e pixUrl salvos
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