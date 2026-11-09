// lib/escola-digital.js
//
// Escola Digital CVB-RJ (2026-11): a aba dos cursos online no site, separada dos presenciais. Liga e desliga no
// painel (modo Online → Cursos online). Começa desligada. Desligada, some para quem visita (menu, /escola-digital,
// venda, sitemap); quem já tem o curso (comprou, vaga de escola, cortesia) continua estudando.
// Spec: docs/superpowers/specs/2026-11-08-escola-digital.md §2

const prisma = require('../db');
const extras = require('./extras');

const CHAVE = 'escola-digital:ligada';
const CHAVE_DESTAQUE = 'escola-digital:destaque'; // id do CursoOnline em destaque na vitrine (ausente = automático)
const CACHE_MS = 30 * 1000; // os 3 serviços do Render leem o banco; 30 s de atraso no máximo depois de mudar
let cache = null; // { valor, ate }
let cacheDestaque = null; // { valor, ate }

function limparCache() { cache = null; cacheDestaque = null; }

async function estaLigada() {
  if (cache && cache.ate > Date.now()) return cache.valor;
  let valor = false;
  try {
    const c = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
    valor = !!c && c.valor === '1';
  } catch (e) {
    console.error('[ESCOLA DIGITAL] leitura do interruptor:', e.message);
  }
  cache = { valor, ate: Date.now() + CACHE_MS };
  return valor;
}

async function definirLigada(ligada, req) {
  if (ligada && !(await prisma.cursoOnline.count({ where: { publicado: true } }))) {
    return { erro: 'Publique um curso antes de ligar a Escola Digital.' };
  }
  const valor = ligada ? '1' : '0';
  await prisma.configuracao.upsert({ where: { chave: CHAVE }, update: { valor }, create: { chave: CHAVE, valor } });
  limparCache();
  await prisma.logAuditoria.create({
    data: { atorId: (req && req.session && req.session.usuarioId) || 'SISTEMA', acao: ligada ? 'ESCOLA_DIGITAL_LIGOU' : 'ESCOLA_DIGITAL_DESLIGOU', alvoTipo: 'Configuracao', alvoId: CHAVE },
  }).catch((e) => console.error('[ESCOLA DIGITAL] auditoria:', e.message));
  return {};
}

// Destaque da vitrine (2026-11-09): id do CursoOnline escolhido na secretaria, ou null (automático).
async function lerDestaque() {
  if (cacheDestaque && cacheDestaque.ate > Date.now()) return cacheDestaque.valor;
  let valor = null;
  try {
    const c = await prisma.configuracao.findUnique({ where: { chave: CHAVE_DESTAQUE } });
    valor = c && c.valor ? c.valor : null;
  } catch (e) {
    console.error('[ESCOLA DIGITAL] leitura do destaque:', e.message);
  }
  cacheDestaque = { valor, ate: Date.now() + CACHE_MS };
  return valor;
}

async function definirDestaque(cursoOnlineId, req) {
  if (cursoOnlineId) {
    const ok = /^[0-9a-f-]{36}$/i.test(String(cursoOnlineId)) && (await prisma.cursoOnline.count({ where: { id: cursoOnlineId, publicado: true } }));
    if (!ok) return { erro: 'Escolha um curso online publicado.' };
    await prisma.configuracao.upsert({ where: { chave: CHAVE_DESTAQUE }, update: { valor: cursoOnlineId }, create: { chave: CHAVE_DESTAQUE, valor: cursoOnlineId } });
  } else {
    await prisma.configuracao.deleteMany({ where: { chave: CHAVE_DESTAQUE } });
  }
  limparCache();
  await prisma.logAuditoria.create({
    data: { atorId: (req && req.session && req.session.usuarioId) || 'SISTEMA', acao: 'ESCOLA_DIGITAL_DESTAQUE', alvoTipo: 'Configuracao', alvoId: CHAVE_DESTAQUE, detalhe: { cursoOnlineId: cursoOnlineId || null } },
  }).catch((e) => console.error('[ESCOLA DIGITAL] auditoria:', e.message));
  return {};
}

// Cursos da página /escola-digital: todo curso online publicado (com preço), no formato do card do catálogo
// (partials/v-card-cat.ejs). Todos levam à página do curso online (online.somenteOnline = true no card).
async function cursosDaEscolaDigital() {
  try {
    const lista = await prisma.cursoOnline.findMany({
      where: { publicado: true, OR: [{ gratuito: true }, { precoOnline: { gt: 0 } }] },
      include: { curso: { select: { id: true, nome: true, descricao: true, imagemUrl: true, cargaHoraria: true, escolaridadeMinima: true } } },
      orderBy: [{ ordemVitrine: 'asc' }, { curso: { nome: 'asc' } }],
    });
    const cursos = lista.map((co) => ({
      ...co.curso, turmas: [],
      online: { preco: co.gratuito ? 0 : Number(co.precoOnline), gratis: co.gratuito, maxParcelas: co.maxParcelas || 1, cursoOnlineId: co.id, somenteOnline: true },
    }));
    await extras.anexar('curso', cursos);
    return cursos;
  } catch (e) {
    console.error('[ESCOLA DIGITAL] lista de cursos:', e.message);
    return [];
  }
}

module.exports = { CHAVE, CHAVE_DESTAQUE, estaLigada, definirLigada, lerDestaque, definirDestaque, cursosDaEscolaDigital, limparCache };
