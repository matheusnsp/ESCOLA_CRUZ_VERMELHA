// lib/transferencia.js
//
// Valores da transferência de turma (2026-11-17). A transferência muda só o valor do CURSO; a taxa de inscrição da
// matrícula fica como está (paga, isenta ou tirada). Antes, o total era recalculado com a taxa configurada hoje no
// curso de destino: quem pagou "R$ 150 com tudo incluso" e trocou de turma no mesmo curso ficava devendo R$ 99.
// Mesmo curso: nada muda. Curso diferente: diferença = curso de destino (no plano, com o cupom gravado, se valer
// nele) − curso atual (valorCursoSemTaxa).

const { calcularValores, valorCursoSemTaxa } = require('./matricula');

const r2 = (x) => Math.round(Number(x) * 100) / 100;

// m: a matrícula com turma.curso e cupomEad. Devolve { valorAntigo, valorNovo, diferenca }.
async function calcularTransferencia(m, cursoDestino) {
  const valorAntigo = r2(m.valorCurso);
  if (m.turma && m.turma.cursoId === cursoDestino.id) return { valorAntigo, valorNovo: valorAntigo, diferenca: 0 };
  const plano = m.plano === 'PARCELADO' ? 'PARCELADO' : 'A_VISTA'; // PRESENCIAL paga o curso pelo preço à vista
  const destino = await calcularValores(cursoDestino, plano, m.alunoId, { matriculaId: m.id });
  const diferenca = r2(Number(destino.valorCurso) - valorCursoSemTaxa(m));
  return { valorAntigo, valorNovo: r2(valorAntigo + diferenca), diferenca };
}

module.exports = { calcularTransferencia };
