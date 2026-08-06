// Middlewares de autenticação e controle de acesso.
// O controle de "quem vê o quê" é validado SEMPRE no servidor, a cada rota.

const asyncHandler = require('../lib/asyncHandler');

// Disponibiliza o usuário logado (se houver) para todas as views.
function exposeUser(req, res, next) {
  if (req.session && req.session.usuarioId) {
    res.locals.usuario = {
      id: req.session.usuarioId,
      nome: req.session.nome,
      papel: req.session.papel,
    };
  } else {
    res.locals.usuario = null;
  }
  next();
}

// Exige que haja um usuário logado. Bloqueia alunos banidos (bloqueioTotal).
const requireLogin = asyncHandler(async function requireLogin(req, res, next) {
  if (!req.session || !req.session.usuarioId) return res.redirect('/login');

  const prisma = require('../db');
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { bloqueioTotal: true },
  });

  if (!usuario || usuario.bloqueioTotal) {
    return req.session.destroy(() => res.redirect('/login?banido=1'));
  }

  return next();
});

// Exige que o usuário logado tenha um dos papéis informados.
function requireRole(...papeis) {
  return (req, res, next) => {
    if (!req.session || !req.session.usuarioId) {
      return res.redirect('/login');
    }
    if (!papeis.includes(req.session.papel)) {
      return res.status(403).render('erro', {
        mensagem: 'Você não tem permissão para acessar esta página.',
      });
    }
    return next();
  };
}

module.exports = { exposeUser, requireLogin, requireRole };