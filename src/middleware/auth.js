// Middlewares de autenticação e controle de acesso.
// O controle de "quem vê o quê" é validado SEMPRE no servidor, a cada rota.

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

// Exige que haja um usuário logado.
function requireLogin(req, res, next) {
  if (req.session && req.session.usuarioId) return next();
  return res.redirect('/login');
}

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
