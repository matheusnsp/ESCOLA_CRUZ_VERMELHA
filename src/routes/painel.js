const express = require('express');
const prisma = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { formatBRL } = require('../lib/matricula');
const { verificarSenha } = require('../lib/password');
const { mascarar } = require('../lib/documento');
const { perfilSchema, ESCOLARIDADES, SITUACOES_ESCOLARIDADE, GENEROS, UFS } = require('../lib/validation');
const { precisaTrocarSenha } = require('../lib/seguranca');

const router = express.Router();

// 💡 C4 — Blindagem contra erros async: envolve automaticamente todo handler
// async registrado neste router com asyncHandler, pra qualquer exceção (ex.:
// timeout do banco) cair no middleware de erro do server em vez de derrubar o
// processo. Middlewares síncronos (rate limiters, requireLogin) passam intactos.
const asyncHandler = require('../lib/asyncHandler');
['get', 'post', 'put', 'delete', 'patch'].forEach((metodo) => {
  const original = router[metodo].bind(router);
  router[metodo] = (caminho, ...handlers) =>
    original(caminho, ...handlers.map((h) =>
      typeof h === 'function' && h.constructor.name === 'AsyncFunction' ? asyncHandler(h) : h));
});

// 💡 NOVO — Esconde da aluna matrículas "fantasma": criadas no banco mas sem
// nenhum pagamento efetivamente confirmado ainda (taxaConfirmada: false E
// statusPagamento ainda no estado inicial PENDENTE). Isso acontece quando a
// pessoa aceita o contrato e escolhe um plano, mas fecha a aba antes de
// completar (ou até tentar) qualquer pagamento — a Matricula já existe no
// banco (é necessária para o Pagamento se vincular a ela), mas não faz
// sentido mostrar como "PENDENTE" pra aluna algo que ela nunca chegou a pagar.
//
// Assim que o webhook confirma a taxa (taxaConfirmada vira true), a matrícula
// passa a aparecer normalmente como PENDENTE — que aí sim significa "só falta
// pagar o curso", e não "não paguei nada ainda".
//
// Matrículas PAGO/PARCELADO/CANCELADO/ESTORNADO sempre aparecem (são
// tentativas reais, com histórico que vale preservar) — só o caso
// PENDENTE + taxaConfirmada:false é filtrado.
const FILTRO_MATRICULA_FANTASMA = {
  NOT: { statusPagamento: 'PENDENTE', taxaConfirmada: false },
};

// Área do aluno — painel único com seções (inscricoes | dados | seguranca | excluir).
router.get('/minha-conta', requireLogin, async (req, res) => {
  const secValidas = ['inscricoes', 'dados', 'seguranca', 'excluir'];
  const sec = secValidas.includes(req.query.sec) ? req.query.sec : 'inscricoes';

  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const [matriculas, matriculasAtivas, senhaPrecisaTrocar] = await Promise.all([
    prisma.matricula.findMany({
      where: { alunoId: usuario.id, ...FILTRO_MATRICULA_FANTASMA },
      orderBy: { criadoEm: 'desc' },
      include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
    }),
    prisma.matricula.count({
      where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' }, ...FILTRO_MATRICULA_FANTASMA },
    }),
    precisaTrocarSenha(usuario.id),
  ]);

  res.render('minha-conta', {
    usuario,
    sec,
    matriculas,
    matriculasAtivas,
    docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : usuario.passaporte ? usuario.passaporte : '—',
    formatBRL,
    inscrito: !!req.query.inscrito,
    escolaridades: ESCOLARIDADES,
    situacoes: SITUACOES_ESCOLARIDADE,
    generos: GENEROS,
    ufs: UFS,
    salvo: !!req.query.salvo,
    erro: null,
    senhaPrecisaTrocar,
    erroSenha: req.query.erroSenha || null,
    senhaAlterada: !!req.query.senhaAlterada,
  });
});

// Atualizar dados do perfil (escolaridade, situação, gênero). E-mail, nome e
// documento não mudam aqui. Endereço vai só como hidden (ver minha-conta.ejs).
router.post('/conta/dados', requireLogin, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const resultado = perfilSchema.safeParse(req.body);
  if (!resultado.success) {
    const [matriculas, matriculasAtivas, senhaPrecisaTrocar] = await Promise.all([
      prisma.matricula.findMany({ where: { alunoId: usuario.id, ...FILTRO_MATRICULA_FANTASMA }, orderBy: { criadoEm: 'desc' }, include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } } }),
      prisma.matricula.count({ where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' }, ...FILTRO_MATRICULA_FANTASMA } }),
      precisaTrocarSenha(usuario.id),
    ]);
    return res.status(400).render('minha-conta', {
      usuario: { ...usuario, escolaridade: req.body.escolaridade || '', escolaridadeSituacao: req.body.escolaridadeSituacao || '', genero: req.body.genero || '',
        cep: req.body.cep || '', logradouro: req.body.logradouro || '', numero: req.body.numero || '',
        complemento: req.body.complemento || '', bairro: req.body.bairro || '', cidade: req.body.cidade || '', uf: req.body.uf || '' },
      sec: 'dados', matriculas, matriculasAtivas,
      docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : usuario.passaporte ? usuario.passaporte : '—',
      formatBRL, inscrito: false, escolaridades: ESCOLARIDADES, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, salvo: false,
      erro: null, erroDados: resultado.error.issues.map((i) => i.message).join(' '),
      senhaPrecisaTrocar, erroSenha: null, senhaAlterada: false,
    });
  }

  // 💡 FIX — este bloco estava faltando: quando a validação passava, o
  // handler não gravava nada no banco nem respondia, deixando a requisição
  // pendurada pra sempre (mesmo bug que já existia em /completar-dados).
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
    const [matriculas, matriculasAtivas, senhaPrecisaTrocar] = await Promise.all([
      prisma.matricula.findMany({
        where: { alunoId: usuario.id, ...FILTRO_MATRICULA_FANTASMA },
        orderBy: { criadoEm: 'desc' },
        include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
      }),
      prisma.matricula.count({
        where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' }, ...FILTRO_MATRICULA_FANTASMA },
      }),
      precisaTrocarSenha(usuario.id),
    ]);
    return res.status(400).render('minha-conta', {
      usuario,
      sec: 'excluir',
      matriculas,
      matriculasAtivas,
      docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : usuario.passaporte ? usuario.passaporte : '—',
      formatBRL,
      inscrito: false,
      erro,
      senhaPrecisaTrocar, erroSenha: null, senhaAlterada: false,
    });
  };

  // Confirma identidade pela senha.
  const senhaOk = await verificarSenha(usuario.senhaHash, req.body.senha || '');
  if (!senhaOk) {
    return reRender('Senha incorreta. A conta não foi excluída.');
  }

  // Bloqueia se houver matrícula ativa (não cancelada) — matrículas "fantasma"
  // (nunca pagas) não contam pra esse bloqueio, ver FILTRO_MATRICULA_FANTASMA.
  const ativas = await prisma.matricula.count({
    where: { alunoId: usuario.id, statusPagamento: { not: 'CANCELADO' }, ...FILTRO_MATRICULA_FANTASMA },
  });
  if (ativas > 0) {
    return reRender('Você tem matrículas ativas. Cancele-as com a secretaria antes de excluir a conta.');
  }

  try {
    // Remove dados ligados ao usuário e o usuário, numa transação.
    // 💡 Nota: aqui removemos TODAS as matrículas do aluno, inclusive as
    // "fantasma" que ficam escondidas na tela — não faz sentido deixar lixo
    // órfão no banco só porque não aparecia na tela.
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