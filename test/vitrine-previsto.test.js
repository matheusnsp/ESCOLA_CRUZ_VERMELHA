// Próximas turmas (/cursos): a data aparece como "Previsto para 22 de novembro" (pedido do Matheus, 2026-11-09),
// no lugar de "Começa em N dias".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vitrine = require('../src/lib/vitrine');

test('quando: "Previsto para <dia> de <mês>"', () => {
  const d = new Date(Date.now() + 12 * 864e5);
  const { dia, mes } = vitrine.dataTurma(d);
  assert.deepEqual(vitrine.quando(d), { rotulo: 'Previsto para', valor: `${Number(dia)} de ${mes}` });
  const hoje = vitrine.dataTurma(new Date());
  assert.deepEqual(vitrine.quando(new Date()), { rotulo: 'Previsto para', valor: `${Number(hoje.dia)} de ${hoje.mes}` });
});
