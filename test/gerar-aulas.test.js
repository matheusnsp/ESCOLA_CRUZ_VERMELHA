// 2026-11-13: "Gerar aulas" na turma (Task 9 do plano docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gerarAulas } = require('../src/public/js/gerar-aulas');

test('terças e quintas de 01/12 a 17/12, 18-22h → 6 aulas com o horário normalizado', () => {
  const r = gerarAulas({ inicio: '2026-12-01', ate: '2026-12-17', dias: [2, 4], horario: '18:00-22:00' });
  assert.equal(r.erro, null);
  assert.deepEqual(r.aulas.map((a) => a.data), ['2026-12-01', '2026-12-03', '2026-12-08', '2026-12-10', '2026-12-15', '2026-12-17']);
  assert.ok(r.aulas.every((a) => a.horario === '18:00 – 22:00'));
});

test('horário em outros formatos', () => {
  assert.equal(gerarAulas({ inicio: '2026-12-05', ate: '2026-12-05', dias: [6], horario: '8h às 17h' }).aulas[0].horario, '08:00 – 17:00');
  assert.equal(gerarAulas({ inicio: '2026-12-05', ate: '2026-12-05', dias: [6], horario: '08:00 – 12:30' }).aulas[0].horario, '08:00 – 12:30');
});

test('dados ruins: avisa e não gera nada', () => {
  const base = { inicio: '2026-12-01', ate: '2026-12-17', dias: [2], horario: '18:00 – 22:00' };
  assert.deepEqual(gerarAulas({ ...base, dias: [] }), { aulas: [], erro: 'Marque pelo menos um dia da semana.' });
  assert.deepEqual(gerarAulas({ ...base, ate: '2026-11-30' }), { aulas: [], erro: 'A data final é antes do início.' });
  assert.deepEqual(gerarAulas({ ...base, horario: 'à noite' }), { aulas: [], erro: 'Horário no formato 18:00 – 22:00.' });
  assert.deepEqual(gerarAulas({ ...base, horario: '25:00 – 26:00' }), { aulas: [], erro: 'Horário no formato 18:00 – 22:00.' });
  assert.deepEqual(gerarAulas({ ...base, dias: [0, 1, 2, 3, 4, 5, 6], ate: '2027-03-01' }), { aulas: [], erro: 'Mais de 60 aulas: diminua o período.' });
  assert.deepEqual(gerarAulas({ ...base, inicio: '' }), { aulas: [], erro: 'Informe o início e a data final.' });
  assert.deepEqual(gerarAulas({ ...base, ate: '2026-02-31' }), { aulas: [], erro: 'Informe o início e a data final.' });
});
