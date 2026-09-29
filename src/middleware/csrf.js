// Proteção CSRF pelo padrão "synchronizer token":
// guardamos um token aleatório na sessão e exigimos que todo POST/PUT/DELETE
// envie esse mesmo token num campo oculto do formulário. Como a sessão fica no
// servidor, não há dependência externa nem token manipulável pelo navegador.
const crypto = require('crypto');

function obterToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function tokensIguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb); // comparação em tempo constante
}

function csrfProtection(req, res, next) {
  // Disponibiliza o token para todas as views (usado no <input hidden>).
  // Preguiçoso: o token só é criado quando a página o imprime (<%= csrfToken %> chama
  // toString). Assim, quem só navega pelas páginas públicas (home, cursos, sobre) não ganha
  // sessão nem cookie, e a página não espera gravar a sessão no banco. Páginas com formulário
  // imprimem o token e criam a sessão como antes.
  res.locals.csrfToken = { toString: () => obterToken(req) };

  // Métodos que não alteram estado não precisam de verificação.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Para formulários multipart (upload), o corpo ainda não foi parseado quando
  // este middleware roda, então aceitamos o token também via query string.
  const enviado = (req.body && req.body._csrf) || (req.query && req.query._csrf);
  if (!tokensIguais(enviado, req.session.csrfToken)) {
    return res.status(403).render('erro', {
      mensagem: 'Sessão inválida ou expirada. Recarregue a página e tente novamente.',
    });
  }

  return next();
}

module.exports = { csrfProtection };
