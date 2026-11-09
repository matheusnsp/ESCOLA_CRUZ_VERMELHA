// lib/ead-ia-fila.js
//
// Fila da criação de curso com IA (etapa 9): passos até não sobrar trabalho (a proposta, o roteiro ou um módulo).
// Desde 2026-11-09 a escrita roda com 2 trabalhadores: dois módulos da mesma geração são escritos ao mesmo tempo
// (a geração tem 2 vagas de marca, `ead-ia:ocupado:<id>` e `ead-ia:ocupado:<id>:b`; nunca mais de 2 módulos juntos,
// mesmo com os 3 serviços). O módulo guarda a marca de quem o escreve (`marca`), para a varredura saber se ele ficou
// para trás. Os 3 serviços do Render rodam este código: cada geração em trabalho tem uma marca em Configuracao
// (`ead-ia:ocupado:<id>`, valor "<hora>:<dono>"), para dois serviços não fazerem o mesmo passo (o roteiro custaria
// duas vezes) nem um "retomar" o módulo que outro está escrevendo. A marca é renovada a cada minuto enquanto a IA
// escreve e vence em 3 min sem renovação (serviço que morreu); a varredura periódica (agendar) destrava o que ficou
// para trás. Cada serviço só apaga a própria marca.
// Spec: docs/superpowers/specs/2026-11-11-ead-ia.md §5.1

const prisma = require('../db');
const IA = require('./ead-ia');

const VALIDADE_MARCA_MS = 3 * 60 * 1000;
const chave = (id) => `ead-ia:ocupado:${id}`;
const VAGAS = (id) => [chave(id), `${chave(id)}:b`]; // escrita de módulos: até 2 por geração
const TRABALHADORES = 2;
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
// `k` é a chave da marca (chave(id) ou uma das VAGAS).
async function pegar(k) {
  const meu = novoValor();
  try {
    await prisma.configuracao.create({ data: { chave: k, valor: meu } });
    return meu;
  } catch (e) {
    if (e.code !== 'P2002') throw e;
  }
  const atual = await prisma.configuracao.findUnique({ where: { chave: k } });
  if (!atual) return pegar(k);
  if (Date.now() - horaDa(atual.valor) < VALIDADE_MARCA_MS) return null;
  const r = await prisma.configuracao.updateMany({ where: { chave: k, valor: atual.valor }, data: { valor: meu } });
  return r.count === 1 ? meu : null;
}
const soltar = (k, meu) => prisma.configuracao.deleteMany({ where: { chave: k, valor: meu } });
async function ocupadaPorOutro(k) {
  const atual = await prisma.configuracao.findUnique({ where: { chave: k } });
  return !!atual && Date.now() - horaDa(atual.valor) < VALIDADE_MARCA_MS;
}

// Faz o trabalho com a marca `k`: renova a cada `renovarMs` enquanto roda (só se ainda for nossa) e solta no fim.
// Devolve false se outro tem a marca, ou se o trabalho devolveu false (não havia o que fazer).
async function comMarca(k, trabalho) {
  let meu = await pegar(k);
  if (!meu) return false;
  const timer = setInterval(async () => {
    const novo = novoValor();
    const r = await prisma.configuracao.updateMany({ where: { chave: k, valor: meu }, data: { valor: novo } }).catch(() => ({ count: 0 }));
    if (r.count === 1) meu = novo;
  }, renovarMs);
  timer.unref();
  let r;
  try {
    r = await trabalho();
  } finally {
    clearInterval(timer);
    await soltar(k, meu).catch(() => {});
  }
  return r !== false;
}

const terminou = (mods) => mods.length > 0 && mods.every((m) => m.status === 'pronto');

// Um passo de trabalho; false quando não há o que fazer.
async function passo(cliente) {
  // Passo a passo (2026-11): a proposta vem antes de tudo (é rápida e a pessoa está esperando por ela).
  const propostas = await prisma.geracaoIaEad.findMany({ where: { status: 'PROPOSTA_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true } });
  for (const g of propostas) {
    if (await comMarca(chave(g.id), async () => { await IA.gerarProposta(g.id, { cliente }); })) return true;
  }
  const roteiros = await prisma.geracaoIaEad.findMany({ where: { status: 'ROTEIRO_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true } });
  for (const g of roteiros) {
    if (await comMarca(chave(g.id), async () => { await IA.gerarRoteiro(g.id, { cliente }); })) return true;
  }
  const imagens = await prisma.geracaoIaEad.findMany({ where: { status: 'FOTOS_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true } });
  for (const g of imagens) {
    if (await comMarca(chave(g.id), async () => { await IA.gerarImagens(g.id, { cliente }); })) return true;
  }
  const gs = await prisma.geracaoIaEad.findMany({ where: { status: 'MODULOS_GERANDO' }, orderBy: { criadoEm: 'asc' }, select: { id: true, modulos: true } });
  for (const g of gs) {
    const mods = Array.isArray(g.modulos) ? g.modulos : [];
    if (terminou(mods)) {
      // Imagens com IA (2026-11-09): antes de concluir, o passo das imagens (capa e abertura dos módulos).
      await prisma.geracaoIaEad.updateMany({ where: { id: g.id, status: 'MODULOS_GERANDO' }, data: { status: 'FOTOS_GERANDO' } });
      return true;
    }
    // Pendentes na ordem; cada um numa vaga livre (2 por geração). gerarModulo devolve false se outro já o pegou.
    const pendentes = mods.filter((m) => m.status === 'pendente').sort((a, b) => a.ordem - b.ordem);
    for (const p of pendentes) {
      for (const k of VAGAS(g.id)) {
        // eslint-disable-next-line no-await-in-loop
        if (await comMarca(k, () => IA.gerarModulo(g.id, p.ordem, { cliente, marca: k }))) return true;
      }
    }
  }
  return false;
}

async function laco(opts) {
  try {
    do {
      deNovo = false;
      const cliente = clienteDe(opts);
      // 2 trabalhadores: cada um faz um passo por vez; juntos escrevem 2 módulos ao mesmo tempo.
      const trabalhador = async () => { while (await passo(cliente)) { /* próximo passo */ } };
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(Array.from({ length: TRABALHADORES }, trabalhador));
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

// Módulo "gerando" cuja marca nenhum serviço tem (ausente ou vencida) volta para pendente; depois,
// trabalha. Roda ao subir e a cada `varreduraMs` (agendar).
async function varrer(opts = {}) {
  try {
    const gs = await prisma.geracaoIaEad.findMany({ where: { status: 'MODULOS_GERANDO' }, select: { id: true, modulos: true } });
    for (const g of gs) {
      const gerando = (Array.isArray(g.modulos) ? g.modulos : []).filter((m) => m.status === 'gerando');
      for (const m of gerando) {
        // A marca de quem escreve (módulos de antes de 2026-11-09 não têm: valia a da geração).
        // eslint-disable-next-line no-await-in-loop
        if (!(await ocupadaPorOutro(m.marca || chave(g.id)))) await IA.devolverModulo(g.id, m.ordem);
      }
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
