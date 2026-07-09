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
router.get('/duvidas', (req, res) => res.render('duvidas'));

router.get('/cursos', async (req, res) => {
  const [cursos, cfgMap] = await Promise.all([
    prisma.curso.findMany({
      where: { ativo: true },
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
          include: { aulas: { orderBy: { data: 'asc' }, take: 1 } },   // ← adicionar
        },
        faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] },
      },
    }),
    lerConfigMatricula(),
]);
  if (!curso || !curso.ativo)
    return res.status(404).render('erro', { mensagem: 'Curso não encontrado.' });

  const outros = await prisma.curso.findMany({
    where: { ativo: true, id: { not: curso.id } },
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

router.get('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } },
});
  if (!turma || turma.status !== 'ABERTA')
    return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });

  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito)
    return res.render('erro', { mensagem: 'Você já está inscrito nesta turma. Veja em "Minha conta".' });

  const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);

  res.render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, erro: null });
});

router.post('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } },
});
  if (!turma || turma.status !== 'ABERTA')
    return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });

  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito) return res.redirect('/minha-conta?jaInscrito=1');

  const reRenderErro = async (msg) => {
    const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    return res.status(400).render('inscrever', {
      turma,
      curso: turma.curso,
      formatBRL,
      aVista,
      erro: msg,
    });
  };

  const resultado = inscricaoSchema.safeParse(req.body);
  if (!resultado.success)
    return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);

  const { forma } = resultado.data;

  // Todos os pagamentos são presenciais por enquanto — sem gateway
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
        statusPagamento: 'PENDENTE',
      },
    });

    await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
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
});

module.exports = router;