// lib/assistente-uso.js
//
// Assistente da secretaria (2026-11-13; spec docs/superpowers/specs/2026-11-13-assistente-secretaria-design.md §6):
// limites por pessoa (20 a cada 10 minutos, 200 por dia) e registro de tokens. Não guarda o texto da conversa.

const prisma = require('../db');

const LIMITE_10MIN = 20;
const LIMITE_DIA = 200;
const MSG_10MIN = 'Você usou muito o assistente agora; tente de novo em alguns minutos.';
const MSG_DIA = 'Você chegou ao limite de mensagens do assistente por hoje. Amanhã ele volta.';

async function podeEnviar(usuarioId, agora = new Date()) {
  const desde10 = new Date(agora.getTime() - 10 * 60 * 1000);
  const desdeDia = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  const [em10, noDia] = await Promise.all([
    prisma.usoAssistente.count({ where: { usuarioId, criadoEm: { gt: desde10, lte: agora } } }),
    prisma.usoAssistente.count({ where: { usuarioId, criadoEm: { gt: desdeDia, lte: agora } } }),
  ]);
  if (em10 >= LIMITE_10MIN) return { ok: false, erro: MSG_10MIN };
  if (noDia >= LIMITE_DIA) return { ok: false, erro: MSG_DIA };
  return { ok: true };
}

async function registrarUso(usuarioId, usage, ferramentas = []) {
  const u = usage || {};
  await prisma.usoAssistente.create({
    data: {
      usuarioId,
      tokensEntrada: Number(u.input_tokens) || 0,
      tokensSaida: Number(u.output_tokens) || 0,
      tokensCache: Number(u.cache_read_input_tokens) || 0,
      ferramentas: [...new Set((ferramentas || []).map(String))].slice(0, 20),
    },
  });
}

module.exports = { LIMITE_10MIN, LIMITE_DIA, podeEnviar, registrarUso };
