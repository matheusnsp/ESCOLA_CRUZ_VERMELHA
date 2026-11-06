// lib/ead-ia-fila.js
//
// Fila da criação de curso com IA (etapa 9): um passo por vez (o roteiro de uma geração ou um módulo), até não
// sobrar trabalho. Os 3 serviços do Render rodam este código: cada geração em trabalho tem uma marca em Configuracao
// (`ead-ia:ocupado:<id>`, renovada a cada passo, vence em 10 min), para dois serviços não fazerem o mesmo passo
// (o roteiro custaria duas vezes) e o serviço que acabou de subir não "retomar" o módulo que outro está escrevendo.
// Spec: docs/superpowers/specs/2026-11-11-ead-ia.md §5.1

const prisma = require('../db');
const IA = require('./ead-ia');

const VALIDADE_MARCA_MS = 10 * 60 * 1000;
const chave = (id) => `ead-ia:ocupado:${id}`;

let rodando = null; // promessa do laço em andamento
let deNovo = false;
let clienteFixo = null; // testes e painel podem fixar um cliente (definirCliente)

const definirCliente = (c) => { clienteFixo = c || null; };
const clienteDe = (opts) => (opts && opts.cliente) || clienteFixo || IA.clientePadrao();

// Pega a geração para este serviço; false se outro serviço a tem há menos de 10 min.
async function pegar(id) {
  const agora = String(Date.now());
  try {
    await prisma.configuracao.create({ data: { chave: chave(id), valor: agora } });
    return true;
  } catch (e) {
    if (e.code !== 'P2002') throw e;
  }
  const atual = await prisma.configuracao.findUnique({ where: { chave: chave(id) } });
  if (!atual) return pegar(id);
  if (Date.now() - Number(atual.valor) < VALIDADE_MARCA_MS) return false;
  const r = await prisma.configuracao.updateMany({ where: { chave: chave(id), valor: atual.valor }, data: { valor: agora } });
  return r.count === 1;
}
const soltar = (id) => prisma.configuracao.deleteMany({ where: { chave: chave(id) } });
async function ocupadaPorOutro(id) {
  const atual = await prisma.configuracao.findUnique({ where: { chave: chave(id) } });
  return !!atual && Date.now() - Number(atual.valor) < VALIDADE_MARCA_MS;
}

const terminou = (mods) => mods.length > 0 && mods.every((m) => m.status === 'pronto');

// Um passo de trabalho; false quando não há o que fazer.
async function passo(cliente) {
  const roteiros = await prisma.geracaoIaEad.findMany({ where: { status: 'ROTEIRO_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true } });
  for (const g of roteiros) {
    if (!(await pegar(g.id))) continue;
    try { await IA.gerarRoteiro(g.id, { cliente }); } finally { await soltar(g.id); }
    return true;
  }
  const gs = await prisma.geracaoIaEad.findMany({ where: { status: 'MODULOS_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true, modulos: true } });
  for (const g of gs) {
    const mods = Array.isArray(g.modulos) ? g.modulos : [];
    const pendente = mods.filter((m) => m.status === 'pendente').sort((a, b) => a.ordem - b.ordem)[0];
    if (!pendente && !terminou(mods)) continue; // erro esperando "tentar de novo", ou outro serviço escrevendo
    if (!(await pegar(g.id))) continue;
    try {
      if (pendente) await IA.gerarModulo(g.id, pendente.ordem, { cliente });
      else await prisma.geracaoIaEad.updateMany({ where: { id: g.id, status: 'MODULOS_GERANDO' }, data: { status: 'CONCLUIDA', materialPdfs: require('@prisma/client').Prisma.DbNull } });
    } finally {
      await soltar(g.id);
    }
    return true;
  }
  return false;
}

async function laco(opts) {
  try {
    do {
      deNovo = false;
      const cliente = clienteDe(opts);
      // eslint-disable-next-line no-await-in-loop
      while (await passo(cliente)) { /* um passo por vez */ }
    } while (deNovo);
  } catch (e) {
    console.error('[EAD IA] fila:', e);
  } finally {
    rodando = null;
  }
}

// Processa até não haver trabalho. Chamado de novo enquanto roda: dá mais uma volta no fim.
function acordar(opts = {}) {
  if (rodando) { deNovo = true; return rodando; }
  rodando = laco(opts);
  return rodando;
}

// Ao subir: módulo "gerando" de geração que nenhum serviço tem volta para pendente; depois, trabalha.
async function retomar(opts = {}) {
  try {
    const gs = await prisma.geracaoIaEad.findMany({ where: { status: 'MODULOS_GERANDO' }, select: { id: true, modulos: true } });
    for (const g of gs) {
      const gerando = (Array.isArray(g.modulos) ? g.modulos : []).filter((m) => m.status === 'gerando');
      if (!gerando.length || await ocupadaPorOutro(g.id)) continue;
      const mods = g.modulos.map((m) => (m.status === 'gerando' ? { ...m, status: 'pendente' } : m));
      await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { modulos: mods } });
    }
  } catch (e) {
    console.error('[EAD IA] retomar:', e.message);
    return;
  }
  acordar(opts);
}

const ocioso = async () => { while (rodando) await rodando; };

module.exports = { acordar, retomar, ocioso, definirCliente };
