// lib/ead-db.js
//
// Acesso ao banco do conteúdo EAD: carregar a árvore de um módulo, devolver o módulo a rascunho
// quando algo dentro dele muda, reordenar irmãos e a regra do módulo final. As regras sem banco
// estão em lib/ead.js.

const prisma = require('../db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehId = (id) => UUID.test(String(id || ''));
const POR_ORDEM = [{ ordem: 'asc' }, { criadoEm: 'asc' }];

// Módulo com tudo dentro, na ordem. É a entrada de pendencias()/avisos() e das telas.
async function carregarModulo(id) {
  if (!ehId(id)) return null;
  return prisma.moduloEad.findUnique({
    where: { id },
    include: {
      cursoOnline: { include: { curso: { select: { id: true, nome: true } } } }, // inclui publicado (aviso no painel)
      topicos: {
        orderBy: POR_ORDEM,
        include: {
          telas: { orderBy: POR_ORDEM },
          perguntas: { orderBy: { criadoEm: 'asc' }, include: { alternativas: { orderBy: { ordem: 'asc' } } } },
        },
      },
      cenarios: { orderBy: POR_ORDEM, include: { decisoes: { orderBy: POR_ORDEM, include: { opcoes: { orderBy: { ordem: 'asc' } } } } } },
    },
  });
}

// Mudou algo num módulo validado: volta para rascunho e fica registrado. Chamar dentro da transação
// da escrita. Devolve true se invalidou.
async function invalidarSeValidado(tx, moduloId, atorId, oQueMudou) {
  const r = await tx.moduloEad.updateMany({
    where: { id: moduloId, status: 'VALIDADO' },
    data: { status: 'RASCUNHO', validadoPor: null, validadoEm: null },
  });
  if (!r.count) return false;
  await tx.logAuditoria.create({
    data: { atorId: atorId || 'SISTEMA', acao: 'EAD_INVALIDOU_MODULO', alvoTipo: 'ModuloEad', alvoId: moduloId, detalhe: JSON.stringify({ moduloId, oQueMudou }) },
  });
  return true;
}

// Troca a ordem com o vizinho de cima/baixo (mesmo pai). Antes, se houver ordens repetidas, renumera
// 0..n-1 na ordem que a tela mostra. Primeiro subindo / último descendo: null, sem escrever.
// filtro: restringe os irmãos (módulos: { final: false }, porque o final fica sempre por último).
async function mover(tx, modelo, id, direcao, campoPai, filtro = {}) {
  const item = await tx[modelo].findUnique({ where: { id } });
  if (!item) return null;
  const irmaos = await tx[modelo].findMany({ where: { [campoPai]: item[campoPai], ...filtro }, orderBy: POR_ORDEM, select: { id: true, ordem: true } });
  const i = irmaos.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const j = direcao === 'subir' ? i - 1 : i + 1;
  if (j < 0 || j >= irmaos.length) return null;
  const repetidas = new Set(irmaos.map((x) => x.ordem)).size !== irmaos.length;
  if (repetidas) {
    for (let k = 0; k < irmaos.length; k++) {
      if (irmaos[k].ordem !== k) await tx[modelo].update({ where: { id: irmaos[k].id }, data: { ordem: k } });
      irmaos[k].ordem = k;
    }
  }
  await tx[modelo].update({ where: { id: irmaos[i].id }, data: { ordem: irmaos[j].ordem } });
  await tx[modelo].update({ where: { id: irmaos[j].id }, data: { ordem: irmaos[i].ordem } });
  return { trocadoCom: irmaos[j].id };
}

async function proximaOrdem(tx, modelo, campoPai, paiId) {
  const r = await tx[modelo].aggregate({ where: { [campoPai]: paiId }, _max: { ordem: true } });
  return r._max.ordem === null ? 0 : r._max.ordem + 1;
}

// Um só módulo final por curso. Módulo final tem cenários e não tem tópicos (e vice-versa).
// Trocar o final: recusa se o final atual tem cenários (viraria módulo comum com cenários); sem
// cenários, o anterior deixa de ser final e, se estava validado, volta a rascunho.
async function marcarFinal(tx, moduloId, final, atorId) {
  const m = await tx.moduloEad.findUnique({ where: { id: moduloId }, include: { _count: { select: { topicos: true, cenarios: true } } } });
  if (!m) return { erro: 'Módulo não encontrado.' };
  if (m.final === final) return {};
  if (final && m._count.topicos) return { erro: 'Para virar o módulo final (de cenários), o módulo não pode ter tópicos.' };
  if (!final && m._count.cenarios) return { erro: 'Apague os cenários antes de deixar de ser o módulo final.' };
  if (final) {
    const anteriores = await tx.moduloEad.findMany({ where: { cursoOnlineId: m.cursoOnlineId, final: true, id: { not: moduloId } }, include: { _count: { select: { cenarios: true } } } });
    // Escola Digital (2026-11, vistoria P1): antes tirava o "final" do outro módulo calado; agora recusa.
    if (anteriores.length) return { erro: `Este curso já tem um módulo final ('${anteriores[0].titulo}'). Desmarque "final" nele antes, ou deixe este como módulo comum.` };
  }
  await tx.moduloEad.update({ where: { id: moduloId }, data: { final } });
  return {};
}

// Sobe a árvore até o módulo: as rotas precisam saber qual módulo invalidar.
const CAMINHO = {
  topico: ['topicoEad', { modulo: true }, (x) => x.modulo],
  tela: ['telaEad', { topico: { include: { modulo: true } } }, (x) => x.topico.modulo],
  pergunta: ['perguntaEad', { topico: { include: { modulo: true } } }, (x) => x.topico.modulo],
  cenario: ['cenarioEad', { modulo: true }, (x) => x.modulo],
  decisao: ['decisaoCenario', { cenario: { include: { modulo: true } } }, (x) => x.cenario.modulo],
};
async function moduloDe(tipo, id) {
  const c = CAMINHO[tipo];
  if (!c || !ehId(id)) return null;
  const x = await prisma[c[0]].findUnique({ where: { id }, include: c[1] });
  if (!x) return null;
  const m = c[2](x);
  return { moduloId: m.id, cursoOnlineId: m.cursoOnlineId };
}

module.exports = { ehId, POR_ORDEM, carregarModulo, invalidarSeValidado, mover, proximaOrdem, marcarFinal, moduloDe };
