// 2026-11-13: turma Confirmada não recebe mais aluno, nem pela secretaria (Matrícula rápida: Encaixar e Mover).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mr = require('../src/lib/matricula-rapida');

test('só turma Aberta recebe aluno; Confirmada tem mensagem própria', () => {
  assert.equal(mr.turmaNaoRecebe({ status: 'ABERTA' }), null);
  assert.match(mr.turmaNaoRecebe({ status: 'CONFIRMADA' }), /confirmada.*não recebe mais alunos/i);
  for (const s of ['CONGELADA', 'CANCELADA', 'ENCERRADA', 'EM_ESPERA', 'ONLINE']) assert.equal(mr.turmaNaoRecebe({ status: s }), 'Escolha uma turma aberta.');
  assert.equal(mr.turmaNaoRecebe(null), 'Escolha uma turma aberta.');
});

test('Encaixar, Mover e a lista de turmas da Matrícula rápida usam só Aberta', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'matricula-rapida.js'), 'utf8');
  assert.doesNotMatch(src, /\['ABERTA', 'CONFIRMADA'\]/);
  assert.equal((src.match(/= turmaNaoRecebe\((turma|destino)\)/g) || []).length, 2, "Encaixar e Mover");
  assert.match(src, /cursoId: \{ in: idsCurso \}, status: 'ABERTA'/);
});

test('quem está numa turma Confirmada ainda pode ser movido para outra turma ou voltar para a espera', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'matricula-rapida.js'), 'utf8');
  const mover = src.slice(src.indexOf('async function moverMatricula'), src.indexOf('async function moverEncaixe'));
  assert.doesNotMatch(mover, /m\.turma\.status (===|!==) 'CONFIRMADA'|CONFIRMADA/, 'Mover não bloqueia quem está em turma Confirmada');
  assert.match(mover, /m\.turma\.status === 'ENCERRADA'/, 'só turma concluída bloqueia o Mover');
  const espera = src.slice(src.indexOf('async function voltarParaEspera'), src.indexOf('async function voltarParaEspera') + 2500);
  assert.doesNotMatch(espera, /CONFIRMADA/);
  assert.match(espera, /m\.turma\.status === 'ENCERRADA'/, 'só turma concluída bloqueia a volta para a espera');
});
