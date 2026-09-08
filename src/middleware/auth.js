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

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — Guarda o destino antes de mandar pro login.
//
// Motivo: os lembretes de pagamento por e-mail linkam direto pra
// /inscrever/:turmaId/pagar-curso. Depois de alguns dias a sessão do aluno
// já expirou, então ele cai no /login — e, sem isto, terminava na home sem
// nenhuma pista do que tinha ido fazer. Com o returnTo salvo, o POST de
// login o devolve exatamente pra tela que ele tentou abrir.
//
// Só guarda GET: um POST não pode ser refeito por redirect (o corpo se
// perde), e POSTs são sempre disparados de dentro de uma tela — quem chega
// de um link externo está sempre em GET.
// ─────────────────────────────────────────────────────────────────────────
function guardarDestino(req) {
  if (req.method !== 'GET') return;
  if (!req.session) return;
  // originalUrl inclui a query string, então filtros e parâmetros sobrevivem.
  req.session.returnTo = req.originalUrl;
}

// Exige que haja um usuário logado. Bloqueia alunos banidos (bloqueioTotal).
const requireLogin = asyncHandler(async function requireLogin(req, res, next) {
  if (!req.session || !req.session.usuarioId) {
    guardarDestino(req);
    return res.redirect('/login');
  }

  const prisma = require('../db');
  const usuario = await prisma.usuario.update({
    where: { id: req.session.usuarioId },
    data: { ultimaAtividade: new Date() },
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
      guardarDestino(req);
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

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — Consome o destino guardado, uma única vez.
//
// Usado no POST de login (ver routes/auth.js). Devolve o caminho salvo e o
// apaga da sessão, pra não reciclar num login futuro.
//
// SEGURANÇA: só aceita caminho interno começando com uma única "/". Isso
// barra open redirect — "//site-malicioso.com" e "https://..." caem no
// padrão e são descartados, porque o navegador trataria "//host" como URL
// absoluta protocol-relative.
// ─────────────────────────────────────────────────────────────────────────
function consumirDestino(req, padrao = '/minha-conta') {
  const destino = req.session && req.session.returnTo;
  if (req.session) delete req.session.returnTo;
  if (typeof destino !== 'string') return padrao;
  if (!destino.startsWith('/') || destino.startsWith('//')) return padrao;
  // Não faz sentido devolver pra tela de autenticação.
  if (/^\/(login|cadastro|logout)\b/.test(destino)) return padrao;
  return destino;
}

module.exports = { exposeUser, requireLogin, requireRole, consumirDestino };