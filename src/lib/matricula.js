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
    // 💡 CORRIGIDO (A7): antes bastava existir QUALQUER matrícula com taxa > 0
    // (mesmo abandonada/cancelada e nunca paga) pra isentar a próxima — perda
    // silenciosa de receita. Agora só isenta se a taxa foi de fato CONFIRMADA.
    const jaPagou = await prisma.matricula.findFirst({
      where: { alunoId, taxaConfirmada: true },
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

  // Valor de cada parcela, apenas quando o plano for PARCELADO.
  // Divide o total (curso + taxa) pelo numero de parcelas do curso.
  let valorParcela = null;
  if (plano === 'PARCELADO') {
    const parcelas = Number(curso.parcelas) || 1;
    valorParcela = total.div(parcelas);
  }

  return { valorCurso, valorTaxaMatricula, total, valorParcela };
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

// ── Quanto falta o aluno pagar ─────────────────────────────────────────────
// Matricula.valorCurso guarda o TOTAL (curso + taxa de inscrição). Com a taxa já paga, o que falta
// é só o curso: o preço do curso no plano da matrícula, sem juros, que é o que /pagar-curso cobra
// (routes/cursos.js) e o que a matrícula rápida usou para montar o total (lib/matricula-rapida.js:
// 180 de curso + 103,95 da taxa paga na instituição = 283,95; falta 180). PRESENCIAL paga o curso
// pelo preço à vista, como em /pagar-curso.
//
// Sem o curso carregado (m.turma.curso), cai no total menos a taxa gravada na matrícula: os dois
// campos são gravados juntos em todos os fluxos, exceto depois de uma transferência.
function valorCursoSemTaxa(m) {
  const curso = m && m.turma && m.turma.curso;
  if (curso) {
    const preco = Number(valorCursoPorPlano(curso, m.plano === 'PARCELADO' ? 'PARCELADO' : 'A_VISTA'));
    if (Number.isFinite(preco) && preco > 0) return preco;
  }
  return Math.max(0, (Number(m.valorCurso) || 0) - (Number(m.valorTaxaMatricula) || 0));
}

// Valor em aberto de uma matrícula PENDENTE (Painel "A receber", Pendentes, Financeiro, relatório).
//   - nada pago (taxa não confirmada): o total, curso + taxa;
//   - taxa paga, curso pendente: só o curso (valorCursoSemTaxa);
//   - transferida depois de pagar o curso: a diferença, se for a maior. Só com a taxa paga, a
//     diferença não vale: falta o curso da turma nova.
// "Curso pago" = um Pagamento CURSO PAGO. confirmadaEm sozinho não basta: o estorno não o apaga.
// Só sem os pagamentos carregados (ou registro antigo sem nenhum Pagamento CURSO) vale confirmadaEm.
function cursoJaPago(m) {
  if (!Array.isArray(m.pagamentos)) return m.confirmadaEm != null;
  const curso = m.pagamentos.filter((p) => p.tipo === 'CURSO');
  if (curso.some((p) => p.status === 'PAGO')) return true;
  return !curso.length && m.confirmadaEm != null;
}

function faltaReceber(m) {
  if (!m || m.statusPagamento !== 'PENDENTE') return 0;
  if (m.diferencaTransferencia != null && cursoJaPago(m)) return Math.max(0, Number(m.diferencaTransferencia) || 0);
  if (!m.taxaConfirmada) return Number(m.valorCurso) || 0;
  return valorCursoSemTaxa(m);
}

module.exports = {
  faltaReceber,
  cursoJaPago,
  valorCursoSemTaxa,
  calcularValores,
  valorCursoPorPlano,
  obterTaxaMatricula,
  formatBRL,
  lerConfigMatricula,
  limparCacheConfig,
  taxaExibicao,
  totalExibicao,
};