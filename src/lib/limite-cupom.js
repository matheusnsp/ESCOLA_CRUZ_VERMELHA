// lib/limite-cupom.js
//
// Limite de tentativas de cupom por IP (revisão I3 da etapa 7): sem ele, dava para testar códigos em sequência
// (CORTESIA, GRATIS…) até achar um de 100%. Vale para a capa (?cupom=) e para a compra com cupom, com o mesmo
// contador. Passou do limite: a requisição segue, marcada (req.cupomBloqueado), e o cupom é ignorado com um aviso.

const rateLimit = require('express-rate-limit');

const MSG_TENTATIVAS = 'Muitas tentativas de cupom. Espere alguns minutos e tente de novo.';
const temCupom = (req) => !!String((req.query && req.query.cupom) || (req.body && req.body.cupom) || '').trim();

const limiteCupom = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req) => !temCupom(req),
  handler: (req, res, next) => { req.cupomBloqueado = true; next(); },
});

module.exports = { limiteCupom, MSG_TENTATIVAS };
