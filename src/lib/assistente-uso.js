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

// Confere o limite e já guarda a linha da mensagem, numa transação com trava por pessoa: assim 25 pedidos
// disparados juntos não passam todos pela conferência antes de qualquer um ser registrado (só 20 passam).
// -> { ok: true, id } | { ok: false, erro }
async function reservar(usuarioId, agora = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'assistente:' + usuarioId}))`;
    const desde10 = new Date(agora.getTime() - 10 * 60 * 1000);
    const desdeDia = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    // Sem teto de data: um pedido paralelo gravado um milissegundo "depois" também conta.
    const em10 = await tx.usoAssistente.count({ where: { usuarioId, criadoEm: { gt: desde10 } } });
    if (em10 >= LIMITE_10MIN) return { ok: false, erro: MSG_10MIN };
    const noDia = await tx.usoAssistente.count({ where: { usuarioId, criadoEm: { gt: desdeDia } } });
    if (noDia >= LIMITE_DIA) return { ok: false, erro: MSG_DIA };
    const r = await tx.usoAssistente.create({ data: { usuarioId, criadoEm: agora }, select: { id: true } });
    return { ok: true, id: r.id };
  });
}

// Falha do lado do servidor/API: a mensagem não conta no limite da pessoa (o custo já foi somado no teto do mês).
async function liberar(id) {
  if (id) await prisma.usoAssistente.deleteMany({ where: { id } });
}

// Com reservaId, completa a linha reservada; sem, cria uma nova.
async function registrarUso(usuarioId, usage, ferramentas = [], reservaId = null) {
  const u = usage || {};
  const data = {
    tokensEntrada: Number(u.input_tokens) || 0,
    tokensSaida: Number(u.output_tokens) || 0,
    tokensCache: Number(u.cache_read_input_tokens) || 0,
    ferramentas: [...new Set((ferramentas || []).map(String))].slice(0, 20),
  };
  if (reservaId) {
    const r = await prisma.usoAssistente.updateMany({ where: { id: reservaId, usuarioId }, data });
    if (r.count) return;
  }
  await prisma.usoAssistente.create({ data: { usuarioId, ...data } });
}

module.exports = { LIMITE_10MIN, LIMITE_DIA, podeEnviar, reservar, liberar, registrarUso };
