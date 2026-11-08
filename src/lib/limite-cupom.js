// lib/limite-cupom.js
//
// Limite de tentativas de cupom por IP (revisão I3 da etapa 7): sem ele, dava para testar códigos em sequência
// (CORTESIA, GRATIS…) até achar um de 100%. Escola Digital (2026-11, vistoria B7): só o código ERRADO conta —
// antes contava toda visita com ?cupom=, e um link de campanha parava de funcionar numa escola com o mesmo Wi-Fi.
// Passou do limite: a requisição segue, marcada (req.cupomBloqueado), e o cupom é ignorado com um aviso.
// O contador é em memória (por instância), como o express-rate-limit que ficava aqui.

const MSG_TENTATIVAS = 'Muitas tentativas de cupom. Espere alguns minutos e tente de novo.';
const JANELA_MS = 15 * 60 * 1000;
const MAX_FALHAS = 30;
const falhas = new Map(); // ip → { n, desde }

const chave = (req) => req.ip || (req.socket && req.socket.remoteAddress) || '?';
function atual(ip, agora = Date.now()) {
  const f = falhas.get(ip);
  if (!f || agora - f.desde > JANELA_MS) { falhas.delete(ip); return null; }
  return f;
}
function limpar(agora = Date.now()) {
  for (const [ip, f] of falhas) if (agora - f.desde > JANELA_MS) falhas.delete(ip);
}

function limiteCupom(req, res, next) {
  const f = atual(chave(req));
  if (f && f.n >= MAX_FALHAS) req.cupomBloqueado = true;
  next();
}

function registrarFalhaCupom(req) {
  const ip = chave(req);
  if (falhas.size > 10000) limpar();
  const f = atual(ip);
  if (f) f.n += 1; else falhas.set(ip, { n: 1, desde: Date.now() });
}

module.exports = { limiteCupom, registrarFalhaCupom, MSG_TENTATIVAS, MAX_FALHAS };
