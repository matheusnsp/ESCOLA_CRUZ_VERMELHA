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
const crypto = require('crypto');
const prisma = require('../db');

const EM_ESPERA = 'EM_ESPERA';

// Data fictícia da turma de espera (fica no fim da lista e nunca "começa").
const INICIO_ESPERA = new Date('2099-12-31T00:00:00Z');

const ehEspera = (turma) => !!turma && turma.status === EM_ESPERA;

// Acha a turma de espera do curso (a mais antiga, se por algum motivo houver mais de uma) ou cria.
// Sem transação interativa (neste projeto elas estouram o tempo no Render): se não existe, um
// $transaction em array (uma só ida ao banco) segura um lock de aviso do Postgres por curso e faz
// INSERT ... WHERE NOT EXISTS; assim duas chamadas simultâneas não criam duas turmas de espera.
// Depois é só ler de novo a mais antiga. As colunas seguem o que o `create` do Prisma gravaria.
async function turmaDeEspera(cursoId) {
  const achar = () => prisma.turma.findFirst({ where: { cursoId, status: EM_ESPERA }, orderBy: { criadoEm: 'asc' } });
  const existente = await achar();
  if (existente) return existente;
  await prisma.$transaction([
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'turma-espera:' + cursoId}))`,
    prisma.$executeRaw`
      INSERT INTO "Turma" ("id", "cursoId", "inicioPrevisto", "vagas", "minimoAlunos", "status", "criadoEm")
      SELECT ${crypto.randomUUID()}, ${cursoId}, TIMESTAMP '2099-12-31 00:00:00', 9999, 0, 'EM_ESPERA'::"StatusTurma", (now() AT TIME ZONE 'UTC')
      WHERE NOT EXISTS (SELECT 1 FROM "Turma" WHERE "cursoId" = ${cursoId} AND "status" = 'EM_ESPERA'::"StatusTurma")`,
  ]);
  return achar();
}

module.exports = { EM_ESPERA, ehEspera, turmaDeEspera };
