// 2026-11-13: "Concluída" escolhida antes do dia seguinte à última aula é salva como Confirmada (agendada).
// Spec: docs/superpowers/specs/2026-11-13-concluida-so-depois-design.md
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ajustarConclusao } = require('../src/lib/concluir-turmas');

const dia = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d, 12, 0, 0); }; // igual parseDateOnly
const AGORA = new Date('2026-11-13T15:00:00Z'); // 13/11 meio-dia em Brasília

test('aula daqui a 3 dias: Concluída vira Confirmada e avisa o 4º dia', () => {
  const dados = { status: 'ENCERRADA', inicioPrevisto: dia('2026-11-14') };
  const aviso = ajustarConclusao(dados, [{ data: dia('2026-11-14') }, { data: dia('2026-11-16') }], AGORA);
  assert.equal(dados.status, 'CONFIRMADA');
  assert.match(aviso, /Confirmada/);
  assert.match(aviso, /17\/11\/2026/);
});

test('última aula hoje: ainda não conclui (só amanhã)', () => {
  const dados = { status: 'ENCERRADA', inicioPrevisto: dia('2026-11-13') };
  const aviso = ajustarConclusao(dados, [{ data: dia('2026-11-13') }], AGORA);
  assert.equal(dados.status, 'CONFIRMADA');
  assert.match(aviso, /14\/11\/2026/);
});

test('última aula ontem: pode concluir', () => {
  const dados = { status: 'ENCERRADA', inicioPrevisto: dia('2026-11-10') };
  assert.equal(ajustarConclusao(dados, [{ data: dia('2026-11-12') }], AGORA), null);
  assert.equal(dados.status, 'ENCERRADA');
});

test('sem aulas: vale o início previsto', () => {
  const d1 = { status: 'ENCERRADA', inicioPrevisto: dia('2026-11-20') };
  assert.match(ajustarConclusao(d1, [], AGORA), /21\/11\/2026/);
  const d2 = { status: 'ENCERRADA', inicioPrevisto: dia('2026-11-01') };
  assert.equal(ajustarConclusao(d2, [], AGORA), null);
});

test('virada do dia é no horário de Brasília (23h de 12/11 em Brasília ainda é 12/11)', () => {
  const dados = { status: 'ENCERRADA', inicioPrevisto: dia('2026-11-12') };
  const aviso = ajustarConclusao(dados, [{ data: dia('2026-11-12') }], new Date('2026-11-13T02:00:00Z'));
  assert.equal(dados.status, 'CONFIRMADA');
  assert.match(aviso, /13\/11\/2026/);
});

test('outros status não mudam', () => {
  for (const s of ['ABERTA', 'CONFIRMADA', 'CONGELADA', 'CANCELADA']) {
    const dados = { status: s, inicioPrevisto: dia('2026-12-01') };
    assert.equal(ajustarConclusao(dados, [{ data: dia('2026-12-01') }], AGORA), null);
    assert.equal(dados.status, s);
  }
});

test('criar e editar turma usam a regra e mostram o aviso; o formulário explica', () => {
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.equal((rota.match(/ajustarConclusao\(/g) || []).length, 1, 'chamado uma vez, em lerTurmaDoForm (criar e editar)');
  assert.match(rota, /function lerTurmaDoForm[\s\S]{0,1500}ajustarConclusao\(/);
  assert.match(rota, /Turma criada\.[\s\S]{0,80}aviso|aviso[\s\S]{0,80}Turma criada\./);
  assert.match(rota, /Turma atualizada\.[\s\S]{0,80}aviso|aviso[\s\S]{0,80}Turma atualizada\./);
  const form = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'turma-form.ejs'), 'utf8');
  assert.match(form, /Concluída só a partir do dia seguinte à última aula/);
});
