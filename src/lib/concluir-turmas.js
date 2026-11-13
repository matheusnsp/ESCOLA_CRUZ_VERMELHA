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

// Formulário da turma (2026-11-13): "Concluída" só a partir do dia seguinte à última aula (sem aula, o início),
// a mesma regra da conclusão automática acima. Antes disso a turma é salva como Confirmada e o sistema a conclui
// sozinho no dia certo. Muda dados.status; devolve o aviso para a tela, ou null quando nada mudou.
// As datas do formulário vêm ao meio-dia no horário do servidor (parseDateOnly), então os campos locais são o dia.
const diaLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeBrasilia = (agora) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);

function ajustarConclusao(dados, aulas, agora = new Date()) {
  if (!dados || dados.status !== 'ENCERRADA') return null;
  const datas = (aulas || []).map((a) => a && a.data).filter((d) => d instanceof Date && !isNaN(d));
  if (!datas.length && dados.inicioPrevisto instanceof Date && !isNaN(dados.inicioPrevisto)) datas.push(dados.inicioPrevisto);
  if (!datas.length) return null;
  const ultimo = datas.map(diaLocal).sort().pop();
  if (ultimo < hojeBrasilia(agora)) return null;
  const [a, m, d] = ultimo.split('-').map(Number);
  const seguinte = new Date(Date.UTC(a, m - 1, d + 1));
  const br = `${String(seguinte.getUTCDate()).padStart(2, '0')}/${String(seguinte.getUTCMonth() + 1).padStart(2, '0')}/${seguinte.getUTCFullYear()}`;
  dados.status = 'CONFIRMADA';
  return `Turma salva como Confirmada: ela vira Concluída sozinha em ${br}, o dia seguinte à última aula.`;
}

module.exports = { concluirTurmasPassadas, ajustarConclusao };
