// lib/ead-ia-fila.js
//
// Fila da criação de curso com IA (etapa 9): um passo por vez (o roteiro de uma geração ou um módulo), até não
// sobrar trabalho. Os 3 serviços do Render rodam este código: cada geração em trabalho tem uma marca em Configuracao
// (`ead-ia:ocupado:<id>`, valor "<hora>:<dono>"), para dois serviços não fazerem o mesmo passo (o roteiro custaria
// duas vezes) nem um "retomar" o módulo que outro está escrevendo. A marca é renovada a cada minuto enquanto a IA
// escreve e vence em 3 min sem renovação (serviço que morreu); a varredura periódica (agendar) destrava o que ficou
// para trás. Cada serviço só apaga a própria marca.
// Spec: docs/superpowers/specs/2026-11-11-ead-ia.md §5.1

const prisma = require('../db');
const IA = require('./ead-ia');

const VALIDADE_MARCA_MS = 3 * 60 * 1000;
const chave = (id) => `ead-ia:ocupado:${id}`;
const horaDa = (valor) => Number(String(valor).split(':')[0]) || 0;
const novoValor = () => `${Date.now()}:${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
let renovarMs = 60 * 1000;
let varreduraMs = 3 * 60 * 1000;
const configurar = (o = {}) => { if (o.renovarMs) renovarMs = o.renovarMs; if (o.varreduraMs) varreduraMs = o.varreduraMs; };

let rodando = null; // promessa do laço em andamento
let deNovo = false;
let clienteFixo = null; // testes e painel podem fixar um cliente (definirCliente)

const definirCliente = (c) => { clienteFixo = c || null; };
const clienteDe = (opts) => (opts && opts.cliente) || clienteFixo || IA.clientePadrao();

// Pega a geração para este serviço: devolve o valor da marca (para renovar e soltar) ou null se outro a tem.
async function pegar(id) {
  const meu = novoValor();
  try {
    await prisma.configuracao.create({ data: { chave: chave(id), valor: meu } });
    return meu;
  } catch (e) {
    if (e.code !== 'P2002') throw e;
  }
  const atual = await prisma.configuracao.findUnique({ where: { chave: chave(id) } });
  if (!atual) return pegar(id);
  if (Date.now() - horaDa(atual.valor) < VALIDADE_MARCA_MS) return null;
  const r = await prisma.configuracao.updateMany({ where: { chave: chave(id), valor: atual.valor }, data: { valor: meu } });
  return r.count === 1 ? meu : null;
}
const soltar = (id, meu) => prisma.configuracao.deleteMany({ where: { chave: chave(id), valor: meu } });
async function ocupadaPorOutro(id) {
  const atual = await prisma.configuracao.findUnique({ where: { chave: chave(id) } });
  return !!atual && Date.now() - horaDa(atual.valor) < VALIDADE_MARCA_MS;
}

// Faz o trabalho com a marca: renova a cada `renovarMs` enquanto roda (só se ainda for nossa) e solta no fim.
async function comMarca(id, trabalho) {
  let meu = await pegar(id);
  if (!meu) return false;
  const timer = setInterval(async () => {
    const novo = novoValor();
    const r = await prisma.configuracao.updateMany({ where: { chave: chave(id), valor: meu }, data: { valor: novo } }).catch(() => ({ count: 0 }));
    if (r.count === 1) meu = novo;
  }, renovarMs);
  timer.unref();
  try {
    await trabalho();
  } finally {
    clearInterval(timer);
    await soltar(id, meu).catch(() => {});
  }
  return true;
}

const terminou = (mods) => mods.length > 0 && mods.every((m) => m.status === 'pronto');

// Um passo de trabalho; false quando não há o que fazer.
async function passo(cliente) {
  const roteiros = await prisma.geracaoIaEad.findMany({ where: { status: 'ROTEIRO_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true } });
  for (const g of roteiros) {
    if (await comMarca(g.id, () => IA.gerarRoteiro(g.id, { cliente }))) return true;
  }
  const gs = await prisma.geracaoIaEad.findMany({ where: { status: 'MODULOS_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true, modulos: true } });
  for (const g of gs) {
    const mods = Array.isArray(g.modulos) ? g.modulos : [];
    const pendente = mods.filter((m) => m.status === 'pendente').sort((a, b) => a.ordem - b.ordem)[0];
    if (!pendente && !terminou(mods)) continue; // erro esperando "tentar de novo", ou outro serviço escrevendo
    const feito = await comMarca(g.id, () => (pendente
      ? IA.gerarModulo(g.id, pendente.ordem, { cliente })
      : prisma.geracaoIaEad.updateMany({ where: { id: g.id, status: 'MODULOS_GERANDO' }, data: { status: 'CONCLUIDA', materialPdfs: require('@prisma/client').Prisma.DbNull } })));
    if (feito) return true;
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

// Módulo "gerando" de geração que nenhum serviço tem (marca ausente ou vencida) volta para pendente; depois,
// trabalha. Roda ao subir e a cada `varreduraMs` (agendar).
async function varrer(opts = {}) {
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

const retomar = varrer;

// Ao subir e depois periodicamente: destrava o que ficou para trás (serviço que morreu no meio de um passo).
function agendar() {
  setTimeout(() => varrer(), 15000).unref();
  setInterval(() => varrer(), varreduraMs).unref();
}

const ocioso = async () => { while (rodando) await rodando; };

module.exports = { acordar, retomar, varrer, agendar, ocioso, definirCliente, configurar };
