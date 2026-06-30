// Calculo dos valores de uma matricula. A regra fica AQUI (servidor), nunca no
// navegador. Le a configuracao da taxa de matricula da tabela Configuracao.
const { Prisma } = require('@prisma/client');
const prisma = require('../db');

const ZERO = new Prisma.Decimal(0);

// Preco do curso conforme o plano escolhido.
function valorCursoPorPlano(curso, plano) {
  return plano === 'A_VISTA' ? curso.precoAvista : curso.precoCheio;
}

// Taxa de matricula, respeitando o modo configurado:
//   POR_CURSO  -> cobra em toda matricula (taxa do curso ou padrao)
//   POR_ALUNO  -> cobra so na primeira matricula do aluno
//   NENHUMA    -> nao cobra
async function obterTaxaMatricula(curso, alunoId) {
  const cfgs = await prisma.configuracao.findMany({
    where: { chave: { in: ['matricula_modo', 'matricula_valor_padrao'] } },
  });
  const mapa = Object.fromEntries(cfgs.map((c) => [c.chave, c.valor]));
  const modo = mapa['matricula_modo'] || 'POR_CURSO';

  if (modo === 'NENHUMA') return ZERO;

  const padrao = new Prisma.Decimal(mapa['matricula_valor_padrao'] || '0');
  const base = curso.taxaMatricula != null ? curso.taxaMatricula : padrao;

  if (modo === 'POR_ALUNO') {
    const jaPagou = await prisma.matricula.findFirst({
      where: { alunoId, valorTaxaMatricula: { gt: 0 } },
    });
    return jaPagou ? ZERO : base;
  }

  return base; // POR_CURSO
}

// Monta os valores de uma matricula (sem persistir).
async function calcularValores(curso, plano, alunoId) {
  const valorCurso = valorCursoPorPlano(curso, plano);
  const valorTaxaMatricula = await obterTaxaMatricula(curso, alunoId);
  const total = new Prisma.Decimal(valorCurso).add(valorTaxaMatricula);
  return { valorCurso, valorTaxaMatricula, total };
}

// Formata um Decimal/numero como moeda BRL.
function formatBRL(valor) {
  const n = Number(valor);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Le a config de matricula uma vez (para listas de cursos).
// Cache em memória da configuração de matrícula (muda raramente).
// Evita uma consulta ao banco a cada carregamento de página.
let _cfgCache = null;
let _cfgCacheEm = 0;
const CFG_TTL_MS = 60 * 1000; // 60s

async function lerConfigMatricula() {
  const agora = Date.now();
  if (_cfgCache && agora - _cfgCacheEm < CFG_TTL_MS) return _cfgCache;
  const cfgs = await prisma.configuracao.findMany({
    where: { chave: { in: ['matricula_modo', 'matricula_valor_padrao'] } },
  });
  _cfgCache = Object.fromEntries(cfgs.map((c) => [c.chave, c.valor]));
  _cfgCacheEm = agora;
  return _cfgCache;
}

// Chamar quando a secretaria altera a configuração, para refletir na hora.
function limparCacheConfig() {
  _cfgCache = null;
  _cfgCacheEm = 0;
}

// Taxa de matricula para EXIBICAO num card (sem contexto de aluno).
function taxaExibicao(curso, cfgMap) {
  const modo = (cfgMap && cfgMap['matricula_modo']) || 'POR_CURSO';
  if (modo === 'NENHUMA') return new Prisma.Decimal(0);
  const padrao = new Prisma.Decimal((cfgMap && cfgMap['matricula_valor_padrao']) || '0');
  return curso.taxaMatricula != null ? curso.taxaMatricula : padrao;
}

// Total a partir de (curso a vista + taxa de matricula) para exibir no card.
function totalExibicao(curso, cfgMap) {
  return new Prisma.Decimal(curso.precoAvista).add(taxaExibicao(curso, cfgMap));
}

module.exports = {
  calcularValores,
  valorCursoPorPlano,
  obterTaxaMatricula,
  formatBRL,
  lerConfigMatricula,
  limparCacheConfig,
  taxaExibicao,
  totalExibicao,
};
