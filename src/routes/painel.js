const express = require('express');
const prisma = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { formatBRL } = require('../lib/matricula');
const { verificarSenha } = require('../lib/password');
const { mascarar } = require('../lib/documento');
const { perfilSchema, ESCOLARIDADES, SITUACOES_ESCOLARIDADE, GENEROS, UFS } = require('../lib/validation');

const router = express.Router();

// Área do aluno — painel único com seções (inscricoes | dados | excluir).
router.get('/minha-conta', requireLogin, async (req, res) => {
  const secValidas = ['inscricoes', 'dados', 'excluir'];
  const sec = secValidas.includes(req.query.sec) ? req.query.sec : 'inscricoes';

  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const [matriculas, matriculasAtivas] = await Promise.all([
    prisma.matricula.findMany({
      where: { alunoId: usuario.id },
      orderBy: { criadoEm: 'desc' },
      include: { turma: { include: { curso: true } } },
    }),
    prisma.matricula.count({
      where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' } },
    }),
  ]);

  res.render('minha-conta', {
    usuario,
    sec,
    matriculas,
    matriculasAtivas,
    docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : '—',
    formatBRL,
    inscrito: !!req.query.inscrito,
    escolaridades: ESCOLARIDADES,
    situacoes: SITUACOES_ESCOLARIDADE,
    generos: GENEROS,
    ufs: UFS,
    salvo: !!req.query.salvo,
    erro: null,
  });
});

// Atualizar dados do perfil (nome + escolaridade). E-mail e CPF não mudam aqui.
router.post('/conta/dados', requireLogin, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const resultado = perfilSchema.safeParse(req.body);
  if (!resultado.success) {
    const [matriculas, matriculasAtivas] = await Promise.all([
      prisma.matricula.findMany({ where: { alunoId: usuario.id }, orderBy: { criadoEm: 'desc' }, include: { turma: { include: { curso: true } } } }),
      prisma.matricula.count({ where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' } } }),
    ]);
    return res.status(400).render('minha-conta', {
      usuario: { ...usuario, escolaridade: req.body.escolaridade || '', escolaridadeSituacao: req.body.escolaridadeSituacao || '', genero: req.body.genero || '',
        cep: req.body.cep || '', logradouro: req.body.logradouro || '', numero: req.body.numero || '',
        complemento: req.body.complemento || '', bairro: req.body.bairro || '', cidade: req.body.cidade || '', uf: req.body.uf || '' },
      sec: 'dados', matriculas, matriculasAtivas,
      docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : '—',
      formatBRL, inscrito: false, escolaridades: ESCOLARIDADES, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, salvo: false,
      erro: null, erroDados: resultado.error.issues.map((i) => i.message).join(' '),
    });
  }

  const { escolaridade, escolaridadeSituacao, genero, cep, logradouro, numero, complemento, bairro, cidade, uf } = resultado.data;
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      escolaridade, escolaridadeSituacao, genero: genero || null,
      cep: cep || null, logradouro: logradouro || null, numero: numero || null,
      complemento: complemento || null, bairro: bairro || null, cidade: cidade || null, uf: uf || null,
    },
  });
  return res.redirect('/minha-conta?sec=dados&salvo=1');
});

// Compatibilidade: /conta agora é a seção "dados" do painel.
router.get('/conta', requireLogin, (req, res) => res.redirect('/minha-conta?sec=dados'));

// Excluir conta — exige senha; bloqueia se houver matrícula ativa.
router.post('/conta/excluir', requireLogin, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const reRender = async (erro) => {
    const [matriculas, matriculasAtivas] = await Promise.all([
      prisma.matricula.findMany({
        where: { alunoId: usuario.id },
        orderBy: { criadoEm: 'desc' },
        include: { turma: { include: { curso: true } } },
      }),
      prisma.matricula.count({
        where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' } },
      }),
    ]);
    return res.status(400).render('minha-conta', {
      usuario,
      sec: 'excluir',
      matriculas,
      matriculasAtivas,
      docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : '—',
      formatBRL,
      inscrito: false,
      erro,
    });
  };

  // Confirma identidade pela senha.
  const senhaOk = await verificarSenha(usuario.senhaHash, req.body.senha || '');
  if (!senhaOk) {
    return reRender('Senha incorreta. A conta não foi excluída.');
  }

  // Bloqueia se houver matrícula ativa (não cancelada).
  const ativas = await prisma.matricula.count({
    where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' } },
  });
  if (ativas > 0) {
    return reRender('Você tem matrículas ativas. Cancele-as com a secretaria antes de excluir a conta.');
  }

  try {
    // Remove dados ligados ao usuário e o usuário, numa transação.
    const matriculas = await prisma.matricula.findMany({
      where: { alunoId: usuario.id },
      select: { id: true },
    });
    const ids = matriculas.map((m) => m.id);

    await prisma.$transaction([
      prisma.pagamento.deleteMany({ where: { matriculaId: { in: ids } } }),
      prisma.matricula.deleteMany({ where: { alunoId: usuario.id } }),
      prisma.tokenAuth.deleteMany({ where: { usuarioId: usuario.id } }),
      prisma.usuario.delete({ where: { id: usuario.id } }),
    ]);

    return req.session.destroy(() => {
      res.clearCookie('escola.sid');
      res.render('conta-excluida');
    });
  } catch (err) {
    console.error('Erro ao excluir conta:', err);
    return reRender('Não foi possível excluir a conta agora. Tente novamente.');
  }
});

// Política de Privacidade (pública). O texto definitivo deve vir do jurídico/DPO.
router.get('/privacidade', (req, res) => {
  res.render('em-breve', {
    titulo: 'Política de Privacidade',
    recurso: 'A Política de Privacidade definitiva deve ser redigida com o jurídico/DPO da instituição.',
  });
});

module.exports = router;
