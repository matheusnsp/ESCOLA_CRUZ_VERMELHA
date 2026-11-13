// 2026-11-13: revisão do assistente contra as telas de hoje (manual, catálogo de links e ferramentas).
require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ctxLib = require('../src/lib/assistente-contexto');
const f = require('../src/lib/assistente-ferramentas');
const manual = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'assistente-manual.md'), 'utf8');
const secao = (titulo) => { const i = manual.indexOf(`## ${titulo}`); assert.ok(i >= 0, `seção ${titulo}`); const j = manual.indexOf('\n## ', i + 3); return manual.slice(i, j < 0 ? undefined : j); };

test('Financeiro: o filtro do endereço é a conta (a busca é na própria tela)', () => {
  assert.deepEqual(ctxLib.CATALOGO['/financeiro'].params, ['conta']);
  const s = secao('Financeiro');
  assert.match(s, /\/financeiro\?conta=<principal\|segunda\|manual>/);
  assert.doesNotMatch(s, /\/financeiro\?q=/);
});

test('Matrícula rápida e Mapa de horários filtram pelo id do curso, não pelo nome', () => {
  assert.match(secao('Matrícula rápida'), /curso=<id do curso>/);
  assert.match(secao('Mapa de horários'), /curso=<id do curso>/);
});

test('Matrícula rápida: Encaixar, Mover e Voltar para a espera, só em turma Aberta', () => {
  const s = secao('Matrícula rápida');
  for (const t of ['Encaixar', 'Mover', 'Voltar para a espera']) assert.match(s, new RegExp(t));
  assert.match(s, /só turma Aberta/i);
  assert.match(s, /Confirmada não recebe/i);
});

test('Turmas: situações e mudanças automáticas como na tela', () => {
  const s = secao('Turmas');
  assert.match(s, /00:00 do dia de início/);
  assert.match(s, /dia seguinte à última aula/);
  assert.match(s, /fica Confirmada até lá/);
  assert.match(s, /Confirmada.*não aceita mais inscrição/);
  assert.match(s, /Congelada/);
  assert.doesNotMatch(s, /some de Pendentes até ser retomada/);
});

test('Matrículas: ações da linha como na tela', () => {
  const s = secao('Matrículas');
  for (const t of ['Confirmar taxa', 'Confirmar pagamento', 'Transferir', 'Nota', 'Estornar', 'Cancelar']) assert.match(s, new RegExp(t));
  assert.doesNotMatch(s, /Remover/);
});

test('Painel: os blocos da tela', () => {
  const s = secao('Painel');
  for (const t of ['Inscrições hoje', 'Recebido', 'A receber', 'Para agir', 'Matrícula rápida', 'Próximas turmas', 'Últimas inscrições']) assert.match(s, new RegExp(t));
});

test('Cursos: o texto completo segue o modelo de 3 parágrafos (Escrever com IA)', () => {
  assert.match(secao('Cursos — presencial'), /3 parágrafos/);
});

test('ferramentas: botões com o nome da tela e regra da Concluída', () => {
  const def = (n) => f.DEFINICOES_FORMULARIO.find((d) => d.name === n).description;
  assert.doesNotMatch(def('preencher_curso'), /clica em Salvar\b/);
  assert.match(def('preencher_curso'), /Criar curso/);
  assert.match(def('preencher_turma'), /Concluída/);
  assert.match(def('preencher_turma'), /dia seguinte à última aula/);
});

test('situação da turma com o nome da tela (Concluída, não ENCERRADA)', () => {
  assert.equal(f.rotuloSituacao('ENCERRADA'), 'Concluída');
  assert.equal(f.rotuloSituacao('ABERTA'), 'Aberta');
  assert.equal(f.rotuloSituacao('CONFIRMADA'), 'Confirmada');
  assert.equal(f.rotuloSituacao('EM_ESPERA'), 'Lista de espera');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'assistente-ferramentas.js'), 'utf8');
  assert.match(src, /situacaoTurma: rotuloSituacao\(m\.turma\.status\)/);
  assert.match(src, /status: rotuloSituacao\(t\.status\)/);
});
