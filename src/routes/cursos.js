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

  const reRenderErro = async (msg) => {
    const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
    return res.status(400).render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: msg });
  };

  const resultado = inscricaoSchema.safeParse(req.body);
  if (!resultado.success) return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);
  const { plano, forma } = resultado.data;
  const usaGateway = forma !== 'DINHEIRO';

  const ocupadas = await prisma.matricula.count({ where: { turmaId: turma.id, statusPagamento: 'PAGO' } });
  if (ocupadas >= turma.vagas) return reRenderErro('Esta turma está com as vagas esgotadas.');

  const { valorCurso, valorTaxaMatricula, total } = await calcularValores(turma.curso, plano, req.session.usuarioId);

  let matricula;
  try {
    matricula = await prisma.matricula.create({
      data: { alunoId: req.session.usuarioId, turmaId: turma.id, plano, forma, valorCurso, valorTaxaMatricula, statusPagamento: 'PENDENTE' },
    });
  } catch (err) {
    if (err.code === 'P2002') return reRenderErro('Você já está inscrito nesta turma.');
    console.error('Erro ao criar matrícula:', err);
    return res.status(500).render('erro', { mensagem: 'Não foi possível concluir a inscrição.' });
  }

  if (!usaGateway) return res.redirect('/minha-conta?inscrito=1');

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { nome: true, email: true, cpfCnpj: true, celular: true },
  });

  if (!aluno?.cpfCnpj) {
    return res.render('erro', { mensagem: 'Para pagamento online é necessário ter CPF cadastrado. Acesse "Minha conta → Meus dados" e adicione seu CPF.' });
  }

  try {
    const resultado = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: turma.curso.nome,
      valorTotal: total,
      forma,
      aluno,
    });

    await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
        gateway: 'unicopag',
        gatewayRef: resultado.gatewayRef,
        metodo: forma,
        valor: total,
        status: 'PENDENTE',
      },
    });

    // Se tiver link de checkout (cartão), redireciona
    if (resultado.checkoutUrl) {
      return res.redirect(resultado.checkoutUrl);
    }

    // PIX: mostra QR code na página de retorno
    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=1&qr=${encodeURIComponent(resultado.pixQrCode || '')}`);

  } catch (err) {
    console.error('[UnicopAg] Erro:', err.message);
    return res.render('erro', { mensagem: 'Sua inscrição foi registrada, mas houve um problema ao abrir o pagamento. Entre em contato com a secretaria.' });
  }
});

router.get('/inscricao/retorno', requireLogin, async (req, res) => {
  const { matriculaId, pix, qr } = req.query;
  const matricula = matriculaId
    ? await prisma.matricula.findUnique({ where: { id: matriculaId }, include: { turma: { include: { curso: true } } } })
    : null;
  res.render('inscricao-retorno', {
    matricula,
    formatBRL,
    isPix: pix === '1',
    pixQrCode: qr ? decodeURIComponent(qr) : null,
  });
});

router.post('/webhook/unicopag', express.json(), async (req, res) => {
  res.sendStatus(200);
  try {
    const { hash, payment_status, external_id } = req.body;
    if (!external_id || !payment_status) return;

    console.log(`[Webhook] ${external_id} → ${payment_status}`);

    if (payment_status === 'paid') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { gatewayRef: hash }, data: { status: 'PAGO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: external_id }, data: { statusPagamento: 'PAGO', confirmadaEm: new Date(), confirmadaPor: 'unicopag' } }),
      ]);
      console.log(`[Webhook] ✅ Matrícula ${external_id} PAGO`);
    } else if (payment_status === 'refunded') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { gatewayRef: hash }, data: { status: 'ESTORNADO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: external_id }, data: { statusPagamento: 'ESTORNADO' } }),
      ]);
      console.log(`[Webhook] 🔄 Matrícula ${external_id} ESTORNADO`);
    } else if (payment_status === 'refused' || payment_status === 'failed') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { gatewayRef: hash }, data: { status: 'CANCELADO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: external_id }, data: { statusPagamento: 'CANCELADO' } }),
      ]);
      console.log(`[Webhook] ❌ Matrícula ${external_id} CANCELADO`);
    } else if (payment_status === 'waiting_payment' || payment_status === 'pending') {
      console.log(`[Webhook] ⏳ Matrícula ${external_id} aguardando`);
    }
  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
  }
});

module.exports = router;
