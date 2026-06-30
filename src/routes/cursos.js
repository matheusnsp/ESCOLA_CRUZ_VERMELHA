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

// ---------- Home (página inicial, renderizada no servidor) ----------

router.get('/', async (req, res) => {
  const [cursos, cfgMap, total] = await Promise.all([
    prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, take: 3 }),
    lerConfigMatricula(),
    prisma.curso.count({ where: { ativo: true } }),
  ]);

  res.render('home', {
    cursos,
    cfgMap,
    temMais: total > cursos.length,
    formatBRL,
    totalExibicao,
  });
});

// ---------- Páginas institucionais (públicas) ----------

router.get('/sobre', (req, res) => res.render('sobre'));
router.get('/seguranca', (req, res) => res.render('seguranca'));

// ---------- Vitrine pública (todos os cursos) ----------

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

// ---------- Detalhe do curso (turmas para inscrição) ----------

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

  if (!curso || !curso.ativo) {
    return res.status(404).render('erro', { mensagem: 'Curso não encontrado.' });
  }

  // Outros cursos (para a seção do fim da página).
  const outros = await prisma.curso.findMany({
    where: { ativo: true, id: { not: curso.id } },
    orderBy: { nome: 'asc' },
    take: 3,
    include: { turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 } },
  });

  res.render('curso-detalhe', { curso, outros, formatBRL, total: totalExibicao(curso, cfgMap), totalExibicao, cfgMap });
});

// ---------- Inscrição (exige login) ----------

router.get('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true },
  });

  if (!turma || turma.status !== 'ABERTA') {
    return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });
  }

  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito) {
    return res.render('erro', { mensagem: 'Você já está inscrito nesta turma. Veja em "Minha conta".' });
  }

  const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
  const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);

  res.render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: null });
});

router.post('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true },
  });

  if (!turma || turma.status !== 'ABERTA') {
    return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });
  }

  const reRenderErro = async (msg) => {
    const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
    return res.status(400).render('inscrever', {
      turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: msg,
    });
  };

  const resultado = inscricaoSchema.safeParse(req.body);
  if (!resultado.success) {
    return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);
  }
  const { plano, forma } = resultado.data;

  const ocupadas = await prisma.matricula.count({
    where: { turmaId: turma.id, statusPagamento: 'PAGO' },
  });
  if (ocupadas >= turma.vagas) {
    return reRenderErro('Esta turma está com as vagas esgotadas.');
  }

  const { valorCurso, valorTaxaMatricula } = await calcularValores(
    turma.curso, plano, req.session.usuarioId
  );

  try {
    await prisma.matricula.create({
      data: {
        alunoId: req.session.usuarioId,
        turmaId: turma.id,
        plano,
        forma,
        valorCurso,
        valorTaxaMatricula,
        statusPagamento: 'PENDENTE',
      },
    });
    return res.redirect('/minha-conta?inscrito=1');
  } catch (err) {
    if (err.code === 'P2002') {
      return reRenderErro('Você já está inscrito nesta turma.');
    }
    console.error('Erro ao inscrever:', err);
    return res.status(500).render('erro', { mensagem: 'Não foi possível concluir a inscrição.' });
  }
});

module.exports = router;
