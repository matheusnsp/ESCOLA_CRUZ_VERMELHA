// lib/ead-duvidas.js
//
// Dúvidas por aula do curso online (etapa 5). O aluno pergunta numa tela; a Escola responde pelo painel
// (só DEV). Para os outros alunos só aparecem as RESPONDIDA. O autor vê também as AGUARDANDO e as
// DESCARTADA ("não publicada"); OCULTA (tirada do ar) ninguém vê. Pergunta e resposta, sem réplica.
// Spec: docs/superpowers/specs/2026-11-07-ead-duvidas.md

const prisma = require('../db');
const { ehId } = require('./ead-db');
const eadTeste = require('./ead-teste');
const { transacao } = require('./transacao');

const MIN = 10; const MAX = 1000; const MAX_RESPOSTA = 2000; const LIMITE_AGUARDANDO = 5;

const capitalizar = (p) => p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');

// "maria da silva" ⇒ "Maria S."; uma palavra só ⇒ só ela. O que os outros alunos veem.
function nomePublico(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Aluno';
  const primeiro = capitalizar(partes[0]);
  if (partes.length === 1) return primeiro;
  return `${primeiro} ${partes[partes.length - 1].charAt(0).toLocaleUpperCase('pt-BR')}.`;
}

async function auditar(atorId, acao, duvidaId, detalhe) {
  await prisma.logAuditoria.create({ data: { atorId: atorId || 'SISTEMA', acao, alvoTipo: 'DuvidaEad', alvoId: duvidaId, detalhe: detalhe || undefined } });
}

async function enviarDuvida({ alunoCursoId, telaId, texto }) {
  const t = String(texto || '').trim();
  if (t.length < MIN) return { ok: false, erro: 'curta' };
  if (t.length > MAX) return { ok: false, erro: 'longa' };
  // Duplo clique (ou F5 no envio): o mesmo texto seguido na mesma tela não grava de novo. A trava de aviso
  // por aluno no curso faz dois envios ao mesmo tempo passarem um de cada vez (a repetição e o limite de
  // 5 aguardando valem também na corrida).
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'duvida:' + alunoCursoId}))`;
    const ultima = await tx.duvidaEad.findFirst({ where: { alunoCursoId, telaId }, orderBy: { criadoEm: 'desc' }, select: { texto: true } });
    if (ultima && ultima.texto === t) return { ok: true, repetida: true };
    const aguardando = await tx.duvidaEad.count({ where: { alunoCursoId, status: 'AGUARDANDO' } });
    if (aguardando >= LIMITE_AGUARDANDO) return { ok: false, erro: 'limite' };
    const duvida = await tx.duvidaEad.create({ data: { alunoCursoId, telaId, texto: t } });
    return { ok: true, duvida };
  });
}

// O que a tela mostra: as do aluno (não respondidas) primeiro, depois as respondidas, mais novas primeiro.
async function duvidasDaTela(telaId, alunoCursoId) {
  const where = alunoCursoId
    ? { telaId, OR: [{ status: 'RESPONDIDA' }, { alunoCursoId, status: { in: ['AGUARDANDO', 'DESCARTADA'] } }] }
    : { telaId, status: 'RESPONDIDA' };
  const lista = await prisma.duvidaEad.findMany({
    where, orderBy: { criadoEm: 'desc' },
    include: { alunoCurso: { select: { usuario: { select: { nome: true } } } } },
  });
  const mapa = (x) => ({
    id: x.id, nome: nomePublico(x.alunoCurso.usuario.nome), texto: x.texto, criadoEm: x.criadoEm, status: x.status,
    resposta: x.status === 'RESPONDIDA' ? x.resposta : null, respondidaEm: x.status === 'RESPONDIDA' ? x.respondidaEm : null,
    minha: !!alunoCursoId && x.alunoCursoId === alunoCursoId,
  });
  const todas = lista.map(mapa);
  const minhasPendentes = todas.filter((x) => x.minha && x.status !== 'RESPONDIDA');
  const respondidas = todas.filter((x) => x.status === 'RESPONDIDA').sort((a, b) => new Date(b.respondidaEm) - new Date(a.respondidaEm));
  return [...minhasPendentes, ...respondidas];
}

async function marcarLidas(alunoCursoId, telaId) {
  await prisma.duvidaEad.updateMany({ where: { alunoCursoId, telaId, status: 'RESPONDIDA', lidaEm: null }, data: { lidaEm: new Date() } });
}

async function respondidasNaoLidas(alunoCursoId) {
  return prisma.duvidaEad.findMany({ where: { alunoCursoId, status: 'RESPONDIDA', lidaEm: null }, orderBy: { respondidaEm: 'desc' }, select: { id: true, telaId: true } });
}

const site = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Trava atômica: só sai de AGUARDANDO uma vez; só quem a passou manda o e-mail.
async function responder(duvidaId, resposta, atorId, { linkBase } = {}) {
  const r = String(resposta || '').trim();
  if (!r) return { ok: false, erro: 'vazia' };
  if (r.length > MAX_RESPOSTA) return { ok: false, erro: 'longa' };
  if (!ehId(duvidaId)) return { ok: false, erro: 'nao_achou' };
  const d = await prisma.duvidaEad.findUnique({
    where: { id: duvidaId },
    include: { tela: { select: { titulo: true } }, alunoCurso: { select: { usuario: { select: { nome: true, email: true } }, cursoOnline: { select: { curso: { select: { nome: true } } } } } } },
  });
  if (!d) return { ok: false, erro: 'nao_achou' };
  const upd = await prisma.duvidaEad.updateMany({
    where: { id: duvidaId, status: 'AGUARDANDO' },
    data: { status: 'RESPONDIDA', resposta: r, respondidaPor: atorId || 'SISTEMA', respondidaEm: new Date(), lidaEm: null },
  });
  if (upd.count === 0) return { ok: false, erro: 'ja_respondida' };
  await auditar(atorId, 'EAD_DUVIDA_RESPONDEU', duvidaId, { resposta: r });
  const u = d.alunoCurso.usuario;
  if (u.email) {
    const link = linkBase ? `${site()}${linkBase}/tela/${d.telaId}#duvidas` : `${site()}/minha-conta?sec=inscricoes`;
    try {
      await require('./email').enviarDuvidaRespondida(u.email, String(u.nome).split(' ')[0], { curso: d.alunoCurso.cursoOnline.curso.nome, tela: d.tela.titulo, link });
    } catch (e) {
      console.error('[EAD] e-mail da dúvida respondida:', e.message);
    }
  }
  return { ok: true };
}

// Mudança de status com trava (só a partir dos status permitidos).
async function mudar(id, de, data, atorId, acao, detalhe) {
  if (!ehId(id)) return { ok: false, erro: 'nao_achou' };
  const upd = await prisma.duvidaEad.updateMany({ where: { id, status: { in: de } }, data });
  if (upd.count === 0) return { ok: false, erro: (await prisma.duvidaEad.count({ where: { id } })) ? 'status' : 'nao_achou' };
  await auditar(atorId, acao, id, detalhe);
  return { ok: true };
}

const descartar = (id, motivo, atorId) => mudar(id, ['AGUARDANDO'], { status: 'DESCARTADA', motivoDescarte: String(motivo || '').trim().slice(0, 500) || null }, atorId, 'EAD_DUVIDA_DESCARTOU', motivo ? { motivo: String(motivo).slice(0, 500) } : null);
const tirarDoAr = (id, atorId) => mudar(id, ['RESPONDIDA'], { status: 'OCULTA' }, atorId, 'EAD_DUVIDA_OCULTOU');
// Volta para Aguardando sem apagar a resposta que já existia: ela fica de rascunho no painel (e na auditoria).
const reabrir = (id, atorId) => mudar(id, ['DESCARTADA', 'OCULTA'], { status: 'AGUARDANDO', respondidaPor: null, respondidaEm: null, lidaEm: null }, atorId, 'EAD_DUVIDA_REABRIU');

async function editarResposta(id, resposta, atorId) {
  const r = String(resposta || '').trim();
  if (!r) return { ok: false, erro: 'vazia' };
  if (r.length > MAX_RESPOSTA) return { ok: false, erro: 'longa' };
  return mudar(id, ['RESPONDIDA'], { resposta: r }, atorId, 'EAD_DUVIDA_EDITOU');
}

const contarAguardando = () => prisma.duvidaEad.count({ where: { status: 'AGUARDANDO' } });

// Central do painel: uma linha por dúvida, com o aluno, de onde ele veio (Pago/Teste) e o link da tela.
async function listarCentral({ status = 'AGUARDANDO', cursoOnlineId = null } = {}) {
  const where = { status, ...(cursoOnlineId && ehId(cursoOnlineId) ? { alunoCurso: { cursoOnlineId } } : {}) };
  const lista = await prisma.duvidaEad.findMany({
    where,
    orderBy: status === 'AGUARDANDO' ? { criadoEm: 'asc' } : { atualizadoEm: 'desc' },
    take: 500,
    include: {
      tela: { select: { id: true, titulo: true, topico: { select: { titulo: true, modulo: { select: { id: true, titulo: true } } } } } },
      alunoCurso: { select: { usuarioId: true, cursoOnlineId: true, usuario: { select: { nome: true, email: true } }, cursoOnline: { select: { cursoId: true, curso: { select: { nome: true } } } } } },
    },
  });
  // Quem tem matrícula na turma online de cada curso (origem "Pago").
  const pares = lista.map((x) => ({ alunoId: x.alunoCurso.usuarioId, cursoId: x.alunoCurso.cursoOnline.cursoId }));
  const mats = pares.length ? await prisma.matricula.findMany({
    where: { OR: pares.map((p) => ({ alunoId: p.alunoId, turma: { cursoId: p.cursoId, status: 'ONLINE' } })) },
    select: { alunoId: true, turma: { select: { cursoId: true } } },
  }) : [];
  const pagos = new Set(mats.map((m) => `${m.alunoId}|${m.turma.cursoId}`));
  const quem = [...new Set(lista.map((x) => x.respondidaPor).filter((v) => v && ehId(v)))];
  const nomes = new Map((quem.length ? await prisma.usuario.findMany({ where: { id: { in: quem } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]));
  const codigos = new Map();
  for (const coId of new Set(lista.map((x) => x.alunoCurso.cursoOnlineId))) codigos.set(coId, await eadTeste.codigoDoCurso(coId));
  return lista.map((x) => {
    const pago = pagos.has(`${x.alunoCurso.usuarioId}|${x.alunoCurso.cursoOnline.cursoId}`);
    const codigo = codigos.get(x.alunoCurso.cursoOnlineId);
    const { alunoCurso, tela, ...duvida } = x;
    return {
      duvida, aluno: alunoCurso.usuario, origem: pago ? 'Pago' : 'Teste',
      respondidaPorNome: duvida.respondidaPor ? nomes.get(duvida.respondidaPor) || (duvida.respondidaPor === 'SISTEMA' ? 'Sistema' : 'Dev') : null,
      cursoOnlineId: alunoCurso.cursoOnlineId, curso: alunoCurso.cursoOnline.curso.nome,
      modulo: tela.topico.modulo.titulo, moduloId: tela.topico.modulo.id, topico: tela.topico.titulo, tela,
      linkBase: pago ? `/online/${alunoCurso.cursoOnline.cursoId}` : codigo ? `/ead-teste/${codigo}` : null,
    };
  });
}

module.exports = {
  nomePublico, enviarDuvida, duvidasDaTela, marcarLidas, respondidasNaoLidas,
  responder, descartar, editarResposta, tirarDoAr, reabrir, contarAguardando, listarCentral,
  MIN, MAX, MAX_RESPOSTA, LIMITE_AGUARDANDO,
};
