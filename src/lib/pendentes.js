// lib/pendentes.js
//
// Quem está com pagamento pendente (tela Pendentes do painel). Tirado da rota em 2026-11-13 para o assistente da
// secretaria usar exatamente a mesma regra. Devolve as matrículas com aluno, turma.curso, pagamentos e cupom.

const prisma = require('../db');
const { FORA_DO_PRESENCIAL } = require('./turma-online');

const STATUS_TURMA_ATIVA = ['ABERTA', 'CONFIRMADA'];
// Turma que ainda dá para aproveitar: aberta/confirmada e com início no futuro (igual a turmaEmAberto da rota).
const turmaEmAberto = (agora = new Date()) => ({ status: { in: STATUS_TURMA_ATIVA }, inicioPrevisto: { gt: agora } });

async function listarPendentes(agora = new Date()) {
  // Turma que ainda dá pra aproveitar: aberta e com início no futuro.
  // O status sozinho não bastava — turma marcada ABERTA com data vencida
  // aparecia como se desse tempo. (O fechamento automático só roda quando
  // alguém acessa o site do aluno, então pode atrasar.)
  const TURMA_VALE = turmaEmAberto(agora);

  const [comTaxa, semTaxa, foraDePrazo] = await Promise.all([
    // ── 1. Taxa paga, curso pendente ──────────────────────────────────────
    prisma.matricula.findMany({
      where: {
        statusPagamento: 'PENDENTE',
        taxaConfirmada: true,
        turma: TURMA_VALE,
      },
      orderBy: { turma: { inicioPrevisto: 'asc' } },
      include: { aluno: true, turma: { include: { curso: true } }, cupomEad: { select: { desconto: true } }, pagamentos: true },
    }),

    // ── 2. Nada pago, ainda dá tempo ──────────────────────────────────────
    prisma.matricula.findMany({
      where: {
        statusPagamento: 'PENDENTE',
        taxaConfirmada: false,
        turma: TURMA_VALE,
      },
      orderBy: { turma: { inicioPrevisto: 'asc' } },
      include: { aluno: true, turma: { include: { curso: true } }, cupomEad: { select: { desconto: true } }, pagamentos: true },
    }),

    // ── 3. Fora de prazo ──────────────────────────────────────────────────
    // Pendente, mas a turma encerrou ou já começou. Não desaparece mais da
    // tela: é gente que ficou pelo caminho e a secretaria pode querer chamar
    // pra outra turma.
    prisma.matricula.findMany({
      where: {
        statusPagamento: 'PENDENTE',
        // Turma congelada (pausada) não é "fora de prazo": fica fora de Pendentes até ser retomada.
        // Turma em espera (sem data) também não: não há prazo a vencer.
        turma: { status: { notIn: ['CONGELADA', ...FORA_DO_PRESENCIAL] } }, // online: cobrança única, fora de Pendentes
        OR: [
          { turma: { status: { notIn: STATUS_TURMA_ATIVA } } },
          { turma: { inicioPrevisto: { lte: agora } } },
        ],
      },
      orderBy: { turma: { inicioPrevisto: 'desc' } },
      include: { aluno: true, turma: { include: { curso: true } }, pagamentos: true },
    }),
  ]);
  return { comTaxa, semTaxa, foraDePrazo };
}

module.exports = { listarPendentes, turmaEmAberto, STATUS_TURMA_ATIVA };
