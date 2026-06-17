const express = require('express');
const prisma = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { formatBRL } = require('../lib/matricula');
const { verificarSenha } = require('../lib/password');
const { mascarar } = require('../lib/documento');

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
    erro: null,
  });
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

// Painel da secretaria — exige login E papel SECRETARIA.
router.get('/admin', requireRole('SECRETARIA'), (req, res) => {
  res.render('admin', { nome: req.session.nome });
});

// Política de Privacidade (pública). O texto definitivo deve vir do jurídico/DPO.
router.get('/privacidade', (req, res) => {
  res.render('em-breve', {
    titulo: 'Política de Privacidade',
    recurso: 'A Política de Privacidade definitiva deve ser redigida com o jurídico/DPO da instituição.',
  });
});

module.exports = router;
