// Conclui sozinha a turma confirmada no dia seguinte ao último dia de aula.
//
// "Último dia" é a maior data entre as aulas cadastradas da turma (uma turma pode ter várias
// datas); sem aula cadastrada, vale a data de início prevista. As datas são comparadas no
// horário de Brasília: uma turma com última aula em 21/10 vira CONCLUÍDA a partir de 22/10.
//
// Só mexe em CONFIRMADA: turma ABERTA (ninguém confirmou) ou CANCELADA fica como está.
// No banco o status continua se chamando ENCERRADA; a tela mostra "CONCLUÍDA"
// (app.locals.rotuloTurma em server.js).
const prisma = require('../db');

async function concluirTurmasPassadas() {
  try {
    const n = await prisma.$executeRaw`
      UPDATE "Turma" t SET status = 'ENCERRADA'
      WHERE t.status = 'CONFIRMADA'
        AND COALESCE(
              (SELECT max(a.data) FROM "AulaData" a WHERE a."turmaId" = t.id),
              (t."inicioPrevisto" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
            ) < (now() AT TIME ZONE 'America/Sao_Paulo')::date`;
    if (n) console.log(`[Turmas] ${n} turma(s) concluída(s) automaticamente.`);
    return n;
  } catch (e) {
    console.error('[Turmas] Falha ao concluir turmas passadas:', e.message);
    return 0;
  }
}

module.exports = { concluirTurmasPassadas };
