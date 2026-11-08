// lib/ead-progresso-db.js
//
// Banco do progresso do aluno no curso online: carregar o curso no formato das regras
// (lib/ead-progresso.js), registrar telas vistas, abrir e responder quiz/pré-teste, jogar cenários.
// Respostas e escolhas travam a linha (SELECT ... FOR UPDATE): dois cliques rápidos contam uma vez só.
// Spec: docs/superpowers/specs/2026-11-05-ead-aluno.md

const prisma = require('../db');
const { POR_ORDEM, ehId } = require('./ead-db');
const { transacao } = require('./transacao');
const { sortear, tamanhoPreTeste, corrigir, aprovado, QUIZ_N } = require('./ead-progresso');
const { minutosDoModulo } = require('./ead');

// Curso com tudo o que as telas do aluno mostram (co) e o mesmo no formato de estadoDoCurso (curso).
async function carregarCursoParaAluno(cursoOnlineId) {
  if (!ehId(cursoOnlineId)) return null;
  const co = await prisma.cursoOnline.findUnique({
    where: { id: cursoOnlineId },
    include: {
      curso: { select: { nome: true, descricao: true, imagemUrl: true } },
      modulos: {
        orderBy: POR_ORDEM,
        include: {
          topicos: { orderBy: POR_ORDEM, include: { telas: { orderBy: POR_ORDEM }, perguntas: { where: { ativa: true }, select: { id: true } } } },
          cenarios: { orderBy: POR_ORDEM, select: { id: true, titulo: true, tempoSugeridoSeg: true } },
        },
      },
    },
  });
  if (!co) return null;
  co.modulos = [...co.modulos.filter((m) => !m.final), ...co.modulos.filter((m) => m.final)];
  // Escola Digital (2026-11): tempo para exibir (o digitado ou o calculado); "0 min" não aparece mais.
  for (const m of co.modulos) m.minutosExibidos = minutosDoModulo(m);
  const curso = {
    modulos: co.modulos.map((m) => {
      const topicos = m.topicos.map((t) => ({ id: t.id, telas: t.telas.map((x) => ({ id: x.id })), nPerguntasAtivas: t.perguntas.length }));
      return { id: m.id, final: m.final, topicos, nPerguntasAtivas: topicos.reduce((s, t) => s + t.nPerguntasAtivas, 0), cenarios: m.cenarios.map((c) => ({ id: c.id })) };
    }),
  };
  return { co, curso };
}

async function garantirAlunoCurso(usuarioId, cursoOnlineId) {
  return prisma.alunoCursoEad.upsert({
    where: { usuarioId_cursoOnlineId: { usuarioId, cursoOnlineId } },
    update: {},
    create: { usuarioId, cursoOnlineId },
  });
}

async function carregarProgresso(alunoCursoId) {
  const ac = await prisma.alunoCursoEad.findUnique({
    where: { id: alunoCursoId },
    include: {
      telasVistas: { select: { telaId: true } },
      tentativas: { select: { tipo: true, moduloId: true, topicoId: true, aprovado: true, concluidaEm: true } },
      cenarios: { select: { cenarioId: true, concluidoEm: true } },
    },
  });
  return { iniciadoEm: ac.iniciadoEm, telasVistas: new Set(ac.telasVistas.map((t) => t.telaId)), tentativas: ac.tentativas, cenarios: ac.cenarios };
}

async function marcarTelaVista(alunoCursoId, telaId) {
  await prisma.telaVistaEad.upsert({
    where: { alunoCursoId_telaId: { alunoCursoId, telaId } },
    update: {},
    create: { alunoCursoId, telaId },
  });
}

async function idsAtivos(where, db = prisma) {
  return (await db.perguntaEad.findMany({ where: { ...where, ativa: true }, select: { id: true } })).map((p) => p.id);
}

// Trava a linha do aluno no curso: duas aberturas ao mesmo tempo (duplo clique) viram uma só.
const travarAluno = (tx, alunoCursoId) => tx.$queryRaw`SELECT id FROM "AlunoCursoEad" WHERE id = ${alunoCursoId} FOR UPDATE`;

// Reaproveita o quiz aberto do tópico; senão sorteia 3, evitando as da tentativa anterior.
// O tópico e as perguntas ativas são lidos fora da transação (não dependem da trava do aluno).
async function abrirQuiz(alunoCursoId, topicoId) {
  const [topico, ids] = await Promise.all([
    prisma.topicoEad.findUnique({ where: { id: topicoId }, select: { moduloId: true } }),
    idsAtivos({ topicoId }),
  ]);
  return transacao(async (tx) => {
  await travarAluno(tx, alunoCursoId);
  const aberta = await tx.tentativaEad.findFirst({ where: { alunoCursoId, topicoId, tipo: 'QUIZ', concluidaEm: null }, orderBy: { criadoEm: 'desc' } });
  if (aberta) return aberta;
  if (!topico || !ids.length) return null;
  const anterior = await tx.tentativaEad.findFirst({ where: { alunoCursoId, topicoId, tipo: 'QUIZ' }, orderBy: { criadoEm: 'desc' } });
  const perguntaIds = sortear(ids, QUIZ_N, anterior ? anterior.perguntaIds : []);
  return tx.tentativaEad.create({ data: { alunoCursoId, tipo: 'QUIZ', moduloId: topico.moduloId, topicoId, perguntaIds, total: perguntaIds.length } });
  });
}

// Uma tentativa por módulo. null se já tentou ou se o módulo tem menos de 8 perguntas ativas.
async function abrirPreTeste(alunoCursoId, moduloId) {
  const ids = await idsAtivos({ topico: { moduloId } }); // fora da trava
  return transacao(async (tx) => {
    await travarAluno(tx, alunoCursoId);
    if (await tx.tentativaEad.count({ where: { alunoCursoId, moduloId, tipo: 'PRE_TESTE' } })) return null;
    const n = tamanhoPreTeste(ids.length);
    if (!n) return null;
    const perguntaIds = sortear(ids, n);
    return tx.tentativaEad.create({ data: { alunoCursoId, tipo: 'PRE_TESTE', moduloId, perguntaIds, total: perguntaIds.length } });
  });
}

// Recalcula a tentativa só com as perguntas que ainda existem (alguma pode ter sido apagada no painel).
function montar(t, perguntas, notaMinima) {
  const porId = new Map(perguntas.map((p) => [p.id, p]));
  const lista = t.perguntaIds.map((id) => porId.get(id)).filter(Boolean);
  const existentes = new Set(lista.map((p) => p.id));
  const respostas = (t.respostas || []).filter((r) => existentes.has(r.perguntaId));
  const acertos = respostas.filter((r) => r.correta).length;
  const respondidas = new Set(respostas.map((r) => r.perguntaId));
  const pendente = lista.find((p) => !respondidas.has(p.id)) || null;
  return { ...t, perguntas: lista, respostas, acertos, total: lista.length, pendente, notaMinima };
}

async function carregarTentativa(db, where) {
  const t = await db.tentativaEad.findFirst({ where, include: { alunoCurso: { select: { cursoOnline: { select: { notaMinimaQuiz: true } } } } } });
  if (!t) return null;
  const perguntas = await db.perguntaEad.findMany({ where: { id: { in: t.perguntaIds } }, include: { alternativas: { orderBy: { ordem: 'asc' } } } });
  return montar(t, perguntas, t.alunoCurso.cursoOnline.notaMinimaQuiz);
}

// Grava o fechamento quando não há mais pergunta pendente (inclusive se as que faltavam foram apagadas).
async function fecharSePreciso(db, t) {
  if (t.concluidaEm || t.pendente) return t;
  const dados = { acertos: t.acertos, total: t.total, aprovado: aprovado(t.acertos, t.total, t.notaMinima), concluidaEm: new Date() };
  await db.tentativaEad.update({ where: { id: t.id }, data: dados });
  return { ...t, ...dados };
}

async function tentativaDoAluno(tentativaId, alunoCursoId) {
  if (!ehId(tentativaId)) return null;
  const t = await carregarTentativa(prisma, { id: tentativaId, alunoCursoId });
  return t ? fecharSePreciso(prisma, t) : null;
}

const perguntaAtual = (tentativa) => (tentativa.concluidaEm ? null : tentativa.pendente);

// Só a pergunta atual é aceita; a resposta repetida ou fora de ordem não muda nada ({ ignorada }).
// As perguntas (e alternativas) da tentativa e a nota mínima são lidas fora da transação: perguntaIds não
// muda depois de sorteado. Dentro dela, só a trava, a releitura das respostas e a gravação.
async function responder(tentativaId, alunoCursoId, perguntaId, alternativaIds) {
  if (!ehId(tentativaId)) return { ignorada: true, tentativa: null };
  const base = await prisma.tentativaEad.findFirst({
    where: { id: tentativaId, alunoCursoId },
    select: { perguntaIds: true, alunoCurso: { select: { cursoOnline: { select: { notaMinimaQuiz: true } } } } },
  });
  if (!base) return { ignorada: true, tentativa: null };
  const perguntas = await prisma.perguntaEad.findMany({ where: { id: { in: base.perguntaIds } }, include: { alternativas: { orderBy: { ordem: 'asc' } } } });
  return transacao(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TentativaEad" WHERE id = ${tentativaId} FOR UPDATE`;
    const linha = await tx.tentativaEad.findUnique({ where: { id: tentativaId } });
    if (!linha) return { ignorada: true, tentativa: null };
    const t = montar(linha, perguntas, base.alunoCurso.cursoOnline.notaMinimaQuiz);
    if (t.concluidaEm || !t.pendente || t.pendente.id !== perguntaId) return { ignorada: true, tentativa: t };
    const pergunta = t.pendente;
    const validas = new Set(pergunta.alternativas.map((a) => a.id));
    const marcadas = [...new Set(alternativaIds || [])].filter((id) => validas.has(id));
    const correta = corrigir(pergunta.alternativas, marcadas);
    const respostas = [...t.respostas, { perguntaId, alternativaIds: marcadas, correta }];
    const nova = montar({ ...t, respostas }, t.perguntas, t.notaMinima);
    const dados = { respostas, acertos: nova.acertos, total: nova.total };
    if (!nova.pendente) Object.assign(dados, { aprovado: aprovado(nova.acertos, nova.total, t.notaMinima), concluidaEm: new Date() });
    await tx.tentativaEad.update({ where: { id: t.id }, data: dados });
    return { correta, pergunta, fechou: !nova.pendente, tentativa: { ...nova, ...dados } };
  });
}

// Em andamento: nunca concluído, ou recomeçado depois de concluído (refazer para treinar).
const cenarioEmAndamento = (feito) => !!feito && (!feito.concluidoEm || feito.iniciadoEm > feito.concluidoEm);

// Identifica a jogada atual (início + decisão + erros): a mesma escolha enviada duas vezes (duplo clique,
// F5 no retorno) só conta uma vez, porque depois da primeira a jogada muda.
const jogadaDe = (feito) => `${new Date(feito.iniciadoEm).getTime()}-${feito.decisaoAtual}-${feito.erros}`;

// Começa ou recomeça um cenário. Refazer um cenário concluído NÃO desfaz a conclusão (o curso continua
// concluído): só zera a jogada (decisão, erros) e marca um novo início.
async function comecarCenario(alunoCursoId, cenarioId) {
  const jogada = { iniciadoEm: new Date(), decisaoAtual: 0, erros: 0 };
  return prisma.cenarioFeitoEad.upsert({
    where: { alunoCursoId_cenarioId: { alunoCursoId, cenarioId } },
    update: jogada,
    create: { alunoCursoId, cenarioId, ...jogada },
  });
}

// Cenário em andamento cuja decisão atual não existe mais (apagada no painel): conclui se ainda há
// decisões (as que faltavam sumiram); devolve o registro atualizado.
async function acertarCenarioSemDecisao(feito, totalDecisoes) {
  if (!cenarioEmAndamento(feito) || feito.decisaoAtual < totalDecisoes || totalDecisoes === 0) return feito;
  return prisma.cenarioFeitoEad.update({
    where: { id: feito.id },
    data: { concluidoEm: new Date(), tempoSeg: Math.max(0, Math.round((Date.now() - feito.iniciadoEm.getTime()) / 1000)) },
  });
}

// As decisões do cenário são lidas fora da transação; dentro dela, só a trava, a jogada e a gravação.
async function escolherNoCenario(alunoCursoId, cenarioId, decisaoId, opcaoId, jogada) {
  const decisoes = await prisma.decisaoCenario.findMany({ where: { cenarioId }, orderBy: POR_ORDEM, include: { opcoes: { orderBy: { ordem: 'asc' } } } });
  return transacao(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CenarioFeitoEad" WHERE "alunoCursoId" = ${alunoCursoId} AND "cenarioId" = ${cenarioId} FOR UPDATE`;
    const feito = await tx.cenarioFeitoEad.findUnique({ where: { alunoCursoId_cenarioId: { alunoCursoId, cenarioId } } });
    if (!cenarioEmAndamento(feito)) return { ignorada: true };
    if (jogada !== undefined && jogada !== jogadaDe(feito)) return { ignorada: true };
    const atual = decisoes[feito.decisaoAtual];
    const opcao = atual && atual.id === decisaoId ? atual.opcoes.find((o) => o.id === opcaoId) : null;
    if (!opcao) return { ignorada: true };
    let dados;
    let fechou = false;
    if (opcao.correta) {
      fechou = feito.decisaoAtual + 1 >= decisoes.length;
      dados = { decisaoAtual: feito.decisaoAtual + 1 };
      if (fechou) Object.assign(dados, { concluidoEm: new Date(), tempoSeg: Math.max(0, Math.round((Date.now() - feito.iniciadoEm.getTime()) / 1000)) });
    } else {
      dados = { erros: feito.erros + 1 };
    }
    const novo = await tx.cenarioFeitoEad.update({ where: { id: feito.id }, data: dados });
    return { certa: opcao.correta, opcao, decisao: atual, fechou, feito: novo };
  });
}

async function marcarCursoConcluido(alunoCursoId) {
  await prisma.alunoCursoEad.updateMany({ where: { id: alunoCursoId, concluidoEm: null }, data: { concluidoEm: new Date() } });
}

module.exports = {
  carregarCursoParaAluno, garantirAlunoCurso, carregarProgresso, marcarTelaVista,
  abrirQuiz, abrirPreTeste, tentativaDoAluno, perguntaAtual, responder,
  comecarCenario, escolherNoCenario, marcarCursoConcluido, cenarioEmAndamento, jogadaDe, acertarCenarioSemDecisao,
};
