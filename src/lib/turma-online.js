// lib/turma-online.js
//
// Turma online permanente (EAD, etapa 4): uma por curso online, status ONLINE, sem aulas, 9999 vagas e
// início fictício em 2099. Quem compra o curso online vira uma Matricula normal nela; assim o pagamento
// passa pela Únicopag, webhook, reconciliação, Financeiro e estorno de sempre. Como a turma de espera
// (lib/turma-espera.js), ela não é "turma de verdade" para as rotinas do presencial.

const crypto = require('crypto');
const prisma = require('../db');

const ONLINE = 'ONLINE';
const ehOnline = (turma) => !!turma && turma.status === ONLINE;
// Turmas que não são "turma de verdade" do presencial: a de espera e a online. Para `status: { notIn }`.
const FORA_DO_PRESENCIAL = ['EM_ESPERA', ONLINE];

// Acha ou cria (mesma técnica de turmaDeEspera: sem transação interativa; lock de aviso por curso e
// INSERT ... WHERE NOT EXISTS, para duas chamadas ao mesmo tempo não criarem duas turmas).
async function turmaOnline(cursoOnline) {
  const cursoId = cursoOnline.cursoId;
  const achar = () => prisma.turma.findFirst({ where: { cursoId, status: ONLINE }, orderBy: { criadoEm: 'asc' } });
  const existente = await achar();
  if (existente) return existente;
  await prisma.$transaction([
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'turma-online:' + cursoId}))`,
    prisma.$executeRaw`
      INSERT INTO "Turma" ("id", "cursoId", "inicioPrevisto", "vagas", "minimoAlunos", "status", "criadoEm")
      SELECT ${crypto.randomUUID()}, ${cursoId}, TIMESTAMP '2099-12-31 00:00:00', 9999, 0, 'ONLINE'::"StatusTurma", (now() AT TIME ZONE 'UTC')
      WHERE NOT EXISTS (SELECT 1 FROM "Turma" WHERE "cursoId" = ${cursoId} AND "status" = 'ONLINE'::"StatusTurma")`,
  ]);
  return achar();
}

module.exports = { FORA_DO_PRESENCIAL, ONLINE, ehOnline, turmaOnline };
