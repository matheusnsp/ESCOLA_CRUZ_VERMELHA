// lib/extras.js
//
// Dados extras de curso e turma (certificado e boas-vindas) guardados na tabela Configuracao, em
// JSON, com a chave "extra:<tipo>:<id>". Assim essas funções não pedem colunas novas no banco:
// em 30/09 uma versão que dependia de colunas novas derrubou a produção porque o banco não tinha
// recebido a migração. Aqui a estrutura do banco que o Prisma usa não muda.
//
//   curso: nomeCertificado, conteudoProgramatico, certificadoValidade
//   turma: instrutorNome, instrutorRegistro, boasVindasDoacao, boasVindasEnviadaEm (ISO)

const prisma = require('../db');

const chave = (tipo, id) => `extra:${tipo}:${id}`;
const ler = (valor) => { try { const o = JSON.parse(valor); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };

async function lerExtra(tipo, id) {
  const c = await prisma.configuracao.findUnique({ where: { chave: chave(tipo, id) } });
  return c ? ler(c.valor) : {};
}

// { id: {…} } para vários ids de uma vez.
async function lerExtras(tipo, ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return {};
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { in: unicos.map((id) => chave(tipo, id)) } } });
  const r = Object.fromEntries(unicos.map((id) => [id, {}]));
  for (const c of cfgs) r[c.chave.slice(chave(tipo, '').length)] = ler(c.valor);
  return r;
}

// Junta com o que já existe; campos vazios/null são apagados. Sem nada, a linha some.
async function salvarExtra(tipo, id, parcial) {
  const novo = { ...(await lerExtra(tipo, id)), ...parcial };
  for (const k of Object.keys(novo)) if (novo[k] === null || novo[k] === undefined || novo[k] === '') delete novo[k];
  if (!Object.keys(novo).length) {
    await prisma.configuracao.deleteMany({ where: { chave: chave(tipo, id) } });
  } else {
    const valor = JSON.stringify(novo);
    await prisma.configuracao.upsert({ where: { chave: chave(tipo, id) }, update: { valor }, create: { chave: chave(tipo, id), valor } });
  }
  return novo;
}

// Coloca os extras dentro dos objetos (turma.instrutorNome, curso.conteudoProgramatico…), para as
// telas e o certificado lerem como campos normais.
async function anexar(tipo, objetos) {
  const lista = objetos.filter(Boolean);
  const extras = await lerExtras(tipo, lista.map((o) => o.id));
  for (const o of lista) Object.assign(o, extras[o.id] || {});
  return objetos;
}

// Ids das turmas que já tiveram as boas-vindas liberadas.
async function turmasComBoasVindas() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'extra:turma:' } } });
  return cfgs.filter((c) => ler(c.valor).boasVindasEnviadaEm).map((c) => c.chave.slice('extra:turma:'.length));
}

module.exports = { lerExtra, lerExtras, salvarExtra, anexar, turmasComBoasVindas };
