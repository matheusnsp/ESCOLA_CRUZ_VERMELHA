// ─────────────────────────────────────────────────────────────────────────
// Lista de espera por curso.
//
// A "turma de espera" é uma turma de verdade no banco (status EM_ESPERA), uma por curso, que
// serve só para guardar quem pagou (ou ao menos se inscreveu) e ainda não tem data: a matrícula
// apenas troca de turma, e pagamentos, notas e histórico ficam intactos. Ela é criada sozinha na
// primeira vez que alguém do curso vai para a espera, com data fictícia no fim de 2099, 9999 vagas
// e nenhuma aula.
//
// Ela nunca aparece como turma aberta (site, secretaria, planilha, selects de encaixe) e é tratada
// como a turma CONGELADA nas rotinas: sem cobrança, sem lembrete, sem contar como "fora de prazo".
// ─────────────────────────────────────────────────────────────────────────
const prisma = require('../db');

const EM_ESPERA = 'EM_ESPERA';

// Data fictícia da turma de espera (fica no fim da lista e nunca "começa").
const INICIO_ESPERA = new Date('2099-12-31T00:00:00Z');

const ehEspera = (turma) => !!turma && turma.status === EM_ESPERA;

// Acha a turma de espera do curso (a mais antiga, se por algum motivo houver mais de uma) ou cria.
// O lock de aviso do Postgres (por curso, liberado no fim da transação) evita que duas chamadas
// simultâneas criem duas turmas de espera; são só duas consultas pequenas.
async function turmaDeEspera(cursoId) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'turma-espera:' + cursoId}))`;
    const existente = await tx.turma.findFirst({
      where: { cursoId, status: EM_ESPERA },
      orderBy: { criadoEm: 'asc' },
    });
    if (existente) return existente;
    return tx.turma.create({
      data: { cursoId, status: EM_ESPERA, inicioPrevisto: INICIO_ESPERA, vagas: 9999, minimoAlunos: 0 },
    });
  });
}

module.exports = { EM_ESPERA, ehEspera, turmaDeEspera };
