// Próximas turmas (/cursos): "Previsto em N dias" (a data já aparece no quadrinho ao lado), "Previsto para amanhã"
// e "Previsto para hoje" (pedido do Matheus, 2026-11-09).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vitrine = require('../src/lib/vitrine');

test('quando: contagem de dias com "Previsto"', () => {
  assert.deepEqual(vitrine.quando(new Date(Date.now() + 12 * 864e5)), { rotulo: 'Previsto em', valor: '12 dias' });
  assert.deepEqual(vitrine.quando(new Date(Date.now() + 864e5)), { rotulo: 'Previsto para', valor: 'amanhã' });
  assert.deepEqual(vitrine.quando(new Date()), { rotulo: 'Previsto para', valor: 'hoje' });
});
