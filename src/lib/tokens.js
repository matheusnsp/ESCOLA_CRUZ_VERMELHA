// Tokens de e-mail (redefinicao de senha e verificacao de e-mail).
//
// Principio: o token que vai no e-mail e aleatorio e de alta entropia. No banco
// guardamos apenas o HASH dele (SHA-256) -- assim, mesmo que alguem leia a tabela,
// nao consegue usar o token. Tokens sao de uso unico e expiram.
const crypto = require('crypto');
const prisma = require('../db');

const TIPO_RESET = 'RESET_SENHA';
const TIPO_VERIFICACAO = 'VERIFICACAO_EMAIL';
const TIPO_2FA = 'LOGIN_2FA';
const TIPO_DESBLOQUEIO = 'DESBLOQUEIO_ADMIN';

const VALIDADE_RESET_MS = 60 * 60 * 1000; // 1 hora
const VALIDADE_VERIFICACAO_MS = 24 * 60 * 60 * 1000; // 24 horas
const VALIDADE_2FA_MS = 10 * 60 * 1000; // 10 minutos
const VALIDADE_DESBLOQUEIO_MS = 60 * 60 * 1000; // 1 hora

function hashToken(tokenEmTextoPuro) {
  return crypto.createHash('sha256').update(tokenEmTextoPuro).digest('hex');
}

// Cria um token de um dado tipo e devolve o valor em texto puro
// (que vai no link do e-mail e NAO e guardado no banco).
async function criarToken(usuarioId, tipo, validadeMs) {
  const tokenEmTextoPuro = crypto.randomBytes(32).toString('hex');

  // Invalida tokens anteriores do mesmo tipo ainda validos deste usuario.
  await prisma.tokenAuth.updateMany({
    where: { usuarioId, tipo, usadoEm: null },
    data: { usadoEm: new Date() },
  });

  await prisma.tokenAuth.create({
    data: {
      usuarioId,
      tipo,
      tokenHash: hashToken(tokenEmTextoPuro),
      expiraEm: new Date(Date.now() + validadeMs),
    },
  });

  return tokenEmTextoPuro;
}

// Verifica um token recebido (de um tipo). Devolve o registro valido ou null.
async function verificarToken(tokenEmTextoPuro, tipo) {
  if (!tokenEmTextoPuro) return null;
  return prisma.tokenAuth.findFirst({
    where: {
      tipo,
      tokenHash: hashToken(tokenEmTextoPuro),
      usadoEm: null,
      expiraEm: { gt: new Date() },
    },
  });
}

// Marca o token como usado (consome). Uso unico.
async function consumirToken(tokenId) {
  await prisma.tokenAuth.update({
    where: { id: tokenId },
    data: { usadoEm: new Date() },
  });
}

// --- Código de verificação em 2 etapas (2FA) por e-mail ---
// Código numérico de 6 dígitos. Guardamos só o hash; expira em 10 min; uso único.
async function criarCodigo2fa(usuarioId) {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await prisma.tokenAuth.updateMany({
    where: { usuarioId, tipo: TIPO_2FA, usadoEm: null },
    data: { usadoEm: new Date() },
  });
  await prisma.tokenAuth.create({
    data: {
      usuarioId,
      tipo: TIPO_2FA,
      tokenHash: hashToken(codigo),
      expiraEm: new Date(Date.now() + VALIDADE_2FA_MS),
    },
  });
  return codigo;
}

// Verifica o código informado para um usuário específico (escopo por usuarioId).
async function verificarCodigo2fa(usuarioId, codigo) {
  if (!usuarioId || !codigo) return null;
  return prisma.tokenAuth.findFirst({
    where: {
      usuarioId,
      tipo: TIPO_2FA,
      tokenHash: hashToken(String(codigo).trim()),
      usadoEm: null,
      expiraEm: { gt: new Date() },
    },
  });
}

// --- Atalhos por tipo ---

const criarTokenReset = (usuarioId) => criarToken(usuarioId, TIPO_RESET, VALIDADE_RESET_MS);
const verificarTokenReset = (token) => verificarToken(token, TIPO_RESET);

const criarTokenVerificacao = (usuarioId) =>
  criarToken(usuarioId, TIPO_VERIFICACAO, VALIDADE_VERIFICACAO_MS);
const verificarTokenVerificacao = (token) => verificarToken(token, TIPO_VERIFICACAO);

const criarTokenDesbloqueio = (usuarioId) =>
  criarToken(usuarioId, TIPO_DESBLOQUEIO, VALIDADE_DESBLOQUEIO_MS);
const verificarTokenDesbloqueio = (token) => verificarToken(token, TIPO_DESBLOQUEIO);

module.exports = {
  consumirToken,
  criarTokenReset,
  verificarTokenReset,
  criarTokenVerificacao,
  verificarTokenVerificacao,
  criarCodigo2fa,
  verificarCodigo2fa,
  criarTokenDesbloqueio,
  verificarTokenDesbloqueio,
};
