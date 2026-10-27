// lib/escola-digital/cenarios.js
//
// Cenários do módulo final (spec §5.6). Sem Express: as rotas (routes/escola-digital/estudo.js)
// guardam o andamento na sessão e chamam `registrarCenario` só no fim. A regra é toda daqui:
// acertos são calculados no servidor a partir de DecisaoCenario.correta, e o tempo nunca reprova.

const prisma = require('../../db');

const SEGUNDOS_MAX = 7200; // duas horas: acima disso o tempo é cortado, não recusado

class ErroCenario extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroCenario';
  }
}

// Quantas escolhas batem com DecisaoCenario.correta (decisões em ordem; escolhas já validadas).
const contarAcertos = (decisoes, escolhas) => escolhas.filter((e, i) => e === decisoes[i].correta).length;

// Tempo gasto em segundos inteiros, de 0 a 7200.
const limitarSegundos = (segundos) => Math.min(SEGUNDOS_MAX, Math.max(0, Math.round(segundos)));

// Registra a conclusão de um cenário e, se com ele todos os cenários do módulo final estão feitos,
// conclui o módulo (ModuloConcluido 'CENARIOS').
//   escolhas: índice da opção escolhida em cada decisão, na ordem das decisões (tamanho = nº de decisões)
//   segundos: tempo gasto; a rota calcula, nunca vem do navegador. Vai para 0–7200, arredondado.
// A primeira conclusão é a que vale: refazer é treino e devolve a linha já gravada, sem alterá-la.
// Não olha a situação da inscrição: quem chama decide se pode gravar (revisão não grava).
//   -> { cenarioFeito, novo: boolean, moduloConcluido: boolean }
//      `moduloConcluido`: o módulo final está concluído depois desta chamada (a Task 11 usa isto
//      para tentar concluir o curso).
async function registrarCenario(inscricaoId, cenarioId, { escolhas, segundos } = {}) {
  const inscricao = await prisma.inscricaoOnline.findUnique({ where: { id: String(inscricaoId) }, select: { id: true, cursoId: true } });
  if (!inscricao) throw new ErroCenario('Inscrição não encontrada');
  const cenario = await prisma.cenarioOnline.findUnique({
    where: { id: String(cenarioId) },
    include: { decisoes: { orderBy: { ordem: 'asc' } }, modulo: { select: { id: true, cursoId: true, final: true } } },
  });
  // Só vale cenário do módulo final do curso da própria inscrição.
  if (!cenario || cenario.modulo.cursoId !== inscricao.cursoId || !cenario.modulo.final) throw new ErroCenario('Cenário não encontrado');

  if (!Array.isArray(escolhas) || escolhas.length !== cenario.decisoes.length) {
    throw new ErroCenario('É preciso uma escolha para cada decisão do cenário');
  }
  const ehIndiceValido = (e, decisao) => Number.isInteger(e) && e >= 0 && e < (Array.isArray(decisao.opcoes) ? decisao.opcoes.length : 0);
  if (!escolhas.every((e, i) => ehIndiceValido(e, cenario.decisoes[i]))) throw new ErroCenario('Escolha inválida');
  if (typeof segundos !== 'number' || !Number.isFinite(segundos)) throw new ErroCenario('Tempo inválido');

  const acertos = contarAcertos(cenario.decisoes, escolhas);
  const tempo = limitarSegundos(segundos);

  // Chave composta (inscrição, cenário): duplicata ignorada, então duas conclusões ao mesmo tempo
  // gravam uma linha só e a primeira vence.
  const criada = await prisma.cenarioFeito.createMany({
    data: [{ inscricaoId: inscricao.id, cenarioId: cenario.id, escolhas, acertos, segundos: tempo }],
    skipDuplicates: true,
  });
  const cenarioFeito = await prisma.cenarioFeito.findUnique({
    where: { inscricaoId_cenarioId: { inscricaoId: inscricao.id, cenarioId: cenario.id } },
  });

  const [total, feitos] = await Promise.all([
    prisma.cenarioOnline.count({ where: { moduloId: cenario.modulo.id } }),
    prisma.cenarioFeito.count({ where: { inscricaoId: inscricao.id, cenario: { moduloId: cenario.modulo.id } } }),
  ]);
  let moduloConcluido = false;
  if (total > 0 && feitos >= total) {
    await prisma.moduloConcluido.createMany({
      data: [{ inscricaoId: inscricao.id, moduloId: cenario.modulo.id, como: 'CENARIOS' }],
      skipDuplicates: true,
    });
    moduloConcluido = true;
  }
  return { cenarioFeito, novo: criada.count > 0, moduloConcluido };
}

module.exports = { registrarCenario, contarAcertos, limitarSegundos, ErroCenario, SEGUNDOS_MAX };
