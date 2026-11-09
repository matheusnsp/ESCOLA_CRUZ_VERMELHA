// lib/ead-cupom.js
//
// Cupom de desconto do curso online (etapa 7). A secretaria (DEV) cria o código no painel; o aluno digita na
// capa do curso. O desconto (em % ou R$) vale antes das parcelas e nunca passa do preço. Usos = compras pagas
// (PAGO/PARCELADO). A compra guarda o cupom em CupomMatriculaEad (uma por matrícula).
// Spec: docs/superpowers/specs/2026-11-09-ead-cupom.md

const prisma = require('../db');
const { ehId } = require('./ead-db');

const TIPOS = ['PERCENTUAL', 'VALOR'];
const PAGOS = ['PAGO', 'PARCELADO'];

const MSG = {
  naoAchou: 'Cupom não encontrado.',
  outroCurso: 'Este cupom não vale para este curso.',
  venceu: 'Este cupom venceu.',
  esgotado: 'Este cupom já foi usado o número máximo de vezes.',
};

const round2 = (x) => Math.round(Number(x) * 100) / 100;
const normalizarCodigo = (texto) => String(texto || '').replace(/\s+/g, '').toUpperCase();
const codigoValido = (codigo) => /^[A-Z0-9-]{3,30}$/.test(String(codigo || ''));

// O cupom vale até o fim do dia de validoAte, no horário do Rio.
function fimDoDiaRio(d) {
  const dia = new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${dia}T23:59:59.999-03:00`);
}

function calcularDesconto(cupom, preco) {
  const precoCheio = round2(preco);
  const bruto = cupom.tipo === 'PERCENTUAL' ? round2((precoCheio * Number(cupom.valor)) / 100) : round2(cupom.valor);
  const desconto = Math.min(Math.max(bruto, 0), precoCheio);
  return { precoCheio, desconto, precoFinal: round2(precoCheio - desconto) };
}

const usosDoCupom = (cupomId) => prisma.cupomMatriculaEad.count({ where: { cupomId, matricula: { statusPagamento: { in: PAGOS } } } });

// alvo: o CursoOnline ou (com { ebook: true }) o Ebook — os dois têm id e precoOnline. E-books (2026-11-09): cupom
// de um curso não vale para e-book e vice-versa; sem curso nem e-book, vale para todos.
async function validarCupom(codigo, co, { ebook = false } = {}) {
  const c = normalizarCodigo(codigo);
  const cupom = codigoValido(c) ? await prisma.cupomEad.findUnique({ where: { codigo: c } }) : null;
  if (!cupom || !cupom.ativo) return { erro: MSG.naoAchou };
  if (cupom.cursoOnlineId && (ebook || cupom.cursoOnlineId !== co.id)) return { erro: MSG.outroCurso };
  if (cupom.ebookId && (!ebook || cupom.ebookId !== co.id)) return { erro: MSG.outroCurso };
  if (cupom.validoAte && fimDoDiaRio(cupom.validoAte) < new Date()) return { erro: MSG.venceu };
  if (cupom.limiteUsos !== null && cupom.limiteUsos !== undefined && await usosDoCupom(cupom.id) >= cupom.limiteUsos) return { erro: MSG.esgotado };
  return { cupom, ...calcularDesconto(cupom, Number(co.precoOnline || 0)) };
}

async function auditar(atorId, acao, cupomId, detalhe) {
  await prisma.logAuditoria.create({ data: { atorId: atorId || 'SISTEMA', acao, alvoTipo: 'CupomEad', alvoId: cupomId, detalhe: detalhe || undefined } });
}

// Confere e normaliza os campos do formulário. Devolve { dados } ou { erro }.
function lerDados(d) {
  const codigo = normalizarCodigo(d.codigo);
  if (!codigoValido(codigo)) return { erro: 'Código: 3 a 30 letras, números ou hífen.' };
  const tipo = TIPOS.includes(d.tipo) ? d.tipo : null;
  if (!tipo) return { erro: 'Escolha o tipo do desconto.' };
  const valor = round2(d.valor);
  if (tipo === 'PERCENTUAL' && !(valor >= 1 && valor <= 100)) return { erro: 'Desconto em %: de 1 a 100.' };
  if (tipo === 'VALOR' && !(valor > 0)) return { erro: 'Desconto em R$: maior que zero.' };
  const temLimite = d.limiteUsos !== null && d.limiteUsos !== undefined && d.limiteUsos !== '';
  const limiteUsos = temLimite ? Number(d.limiteUsos) : null;
  if (temLimite && !(Number.isInteger(limiteUsos) && limiteUsos >= 1)) return { erro: 'Limite de usos: 1 ou mais.' };
  // "Vale para" (2026-11-09): alvo = "curso:<id>" | "ebook:<id>" | "" (todos). cursoOnlineId solto ainda vale.
  const alvo = /^(curso|ebook):(.+)$/.exec(String(d.alvo || ''));
  const cursoOnlineId = alvo ? (alvo[1] === 'curso' && ehId(alvo[2]) ? alvo[2] : null) : (d.cursoOnlineId && ehId(d.cursoOnlineId) ? d.cursoOnlineId : null);
  const ebookId = alvo && alvo[1] === 'ebook' && ehId(alvo[2]) ? alvo[2] : null;
  const validoAte = d.validoAte ? new Date(d.validoAte) : null;
  if (validoAte && Number.isNaN(validoAte.getTime())) return { erro: 'Validade inválida.' };
  return { dados: { codigo, tipo, valor, cursoOnlineId, ebookId, validoAte, limiteUsos, observacao: String(d.observacao || '').trim().slice(0, 500) || null } };
}

const repetido = (e) => e && e.code === 'P2002';

async function criarCupom(d, atorId) {
  const r = lerDados(d);
  if (r.erro) return r;
  try {
    const cupom = await prisma.cupomEad.create({ data: { ...r.dados, criadoPor: atorId || 'SISTEMA' } });
    await auditar(atorId, 'EAD_CUPOM_CRIADO', cupom.id, { codigo: cupom.codigo, tipo: cupom.tipo, valor: Number(cupom.valor) });
    return { cupom };
  } catch (e) {
    if (repetido(e)) return { erro: 'Já existe um cupom com esse código.' };
    throw e;
  }
}

async function alterarCupom(id, d, atorId) {
  const atual = ehId(id) ? await prisma.cupomEad.findUnique({ where: { id } }) : null;
  if (!atual) return { erro: 'Cupom não encontrado.' };
  const r = lerDados(d);
  if (r.erro) return r;
  const temCompra = await prisma.cupomMatriculaEad.count({ where: { cupomId: id } }) > 0;
  if (temCompra && (r.dados.codigo !== atual.codigo || r.dados.tipo !== atual.tipo)) return { erro: 'Este cupom já foi usado: o código e o tipo não mudam.' };
  try {
    const cupom = await prisma.cupomEad.update({ where: { id }, data: r.dados });
    await auditar(atorId, 'EAD_CUPOM_ALTERADO', id, { antes: { codigo: atual.codigo, valor: Number(atual.valor), validoAte: atual.validoAte, limiteUsos: atual.limiteUsos }, depois: { codigo: cupom.codigo, valor: Number(cupom.valor), validoAte: cupom.validoAte, limiteUsos: cupom.limiteUsos } });
    return { cupom };
  } catch (e) {
    if (repetido(e)) return { erro: 'Já existe um cupom com esse código.' };
    throw e;
  }
}

async function ativarCupom(id, ativo, atorId) {
  if (!ehId(id)) return { erro: 'Cupom não encontrado.' };
  const r = await prisma.cupomEad.updateMany({ where: { id }, data: { ativo: !!ativo } });
  if (!r.count) return { erro: 'Cupom não encontrado.' };
  await auditar(atorId, ativo ? 'EAD_CUPOM_ATIVADO' : 'EAD_CUPOM_DESATIVADO', id);
  return { ok: true };
}

async function apagarCupom(id, atorId) {
  const cupom = ehId(id) ? await prisma.cupomEad.findUnique({ where: { id } }) : null;
  if (!cupom) return { erro: 'Cupom não encontrado.' };
  if (await prisma.cupomMatriculaEad.count({ where: { cupomId: id } })) return { erro: 'Este cupom já foi usado e não pode ser apagado.' };
  await prisma.cupomEad.delete({ where: { id } });
  await auditar(atorId, 'EAD_CUPOM_APAGADO', id, { codigo: cupom.codigo });
  return { ok: true };
}

async function listarCupons({ ativos } = {}) {
  const where = ativos === undefined ? {} : { ativo: !!ativos };
  const cupons = await prisma.cupomEad.findMany({
    where,
    orderBy: { criadoEm: 'desc' },
    include: { cursoOnline: { select: { curso: { select: { nome: true } } } }, ebook: { select: { curso: { select: { nome: true } } } } },
  });
  const pagas = cupons.length ? await prisma.cupomMatriculaEad.groupBy({
    by: ['cupomId'],
    where: { cupomId: { in: cupons.map((c) => c.id) }, matricula: { statusPagamento: { in: PAGOS } } },
    _count: { _all: true },
    _sum: { desconto: true },
  }) : [];
  const porCupom = new Map(pagas.map((p) => [p.cupomId, p]));
  return cupons.map((c) => {
    const p = porCupom.get(c.id);
    return { ...c, curso: c.cursoOnline ? c.cursoOnline.curso.nome : c.ebook ? `E-book: ${c.ebook.curso.nome}` : null, usos: p ? p._count._all : 0, totalDesconto: p ? round2(p._sum.desconto || 0) : 0 };
  });
}

async function comprasDoCupom(id) {
  if (!ehId(id)) return [];
  const cs = await prisma.cupomMatriculaEad.findMany({
    where: { cupomId: id },
    orderBy: { criadoEm: 'desc' },
    include: { matricula: { select: { statusPagamento: true, aluno: { select: { nome: true, email: true } }, turma: { select: { curso: { select: { nome: true } } } } } } },
  });
  return cs.map((c) => ({
    aluno: c.matricula.aluno,
    curso: c.matricula.turma.curso.nome,
    data: c.criadoEm,
    precoCheio: Number(c.precoCheio),
    desconto: Number(c.desconto),
    precoFinal: Number(c.precoFinal),
    situacao: c.matricula.statusPagamento,
  }));
}

module.exports = {
  TIPOS, MSG, lerDados, normalizarCodigo, codigoValido, calcularDesconto, validarCupom, usosDoCupom,
  criarCupom, alterarCupom, ativarCupom, apagarCupom, listarCupons, comprasDoCupom, auditar,
};
