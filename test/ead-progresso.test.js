// Regras do progresso do aluno (src/lib/ead-progresso.js) e conta (src/lib/ead-conta.js). Sem banco.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/lib/ead-progresso');
const { cadastroIncompleto } = require('../src/lib/ead-conta');

const DIA = 24 * 60 * 60 * 1000;
const INICIO = new Date('2026-11-01T12:00:00Z');

// M1 e M2: 1 tópico, 2 telas, 3 perguntas; M3: sem telas; F: final com 1 cenário.
const curso = {
  modulos: [
    { id: 'm1', final: false, nPerguntasAtivas: 3, topicos: [{ id: 't1', telas: [{ id: 'a' }, { id: 'b' }], nPerguntasAtivas: 3 }], cenarios: [] },
    { id: 'm2', final: false, nPerguntasAtivas: 8, topicos: [{ id: 't2', telas: [{ id: 'c' }, { id: 'd' }], nPerguntasAtivas: 8 }], cenarios: [] },
    { id: 'm3', final: false, nPerguntasAtivas: 0, topicos: [], cenarios: [] },
    { id: 'f', final: true, nPerguntasAtivas: 0, topicos: [], cenarios: [{ id: 'c1' }] },
  ],
};
const prog = (extra = {}) => ({ iniciadoEm: INICIO, telasVistas: new Set(), tentativas: [], cenarios: [], ...extra });
const quizOk = (moduloId, topicoId) => ({ tipo: 'QUIZ', moduloId, topicoId, aprovado: true, concluidaEm: INICIO });
const mod = (e, id) => e.modulos.find((m) => m.id === id);
// M3 não tem tópicos: só fica concluído pelo pré-teste. Para os cenários de "todos concluídos", usa um curso sem M3.
const semM3 = { modulos: curso.modulos.filter((m) => m.id !== 'm3') };

describe('estadoDoCurso', () => {
  test('dia 0, nada feito', () => {
    const e = p.estadoDoCurso(curso, prog(), INICIO);
    assert.equal(mod(e, 'm1').estado, 'disponivel');
    assert.equal(mod(e, 'm2').estado, 'bloqueado');
    assert.equal(mod(e, 'm2').motivo, 'Abre depois do Módulo 1.');
    assert.equal(mod(e, 'f').estado, 'bloqueado');
    assert.equal(mod(e, 'f').motivo, 'Abre quando os outros módulos terminarem.');
    assert.deepEqual(e.proximo, { tipo: 'tela', id: 'a' });
    assert.equal(e.sequencial, true);
    assert.equal(e.percentual, 0);
    assert.equal(mod(e, 'm1').numero, 1);
  });
  test('telas vistas sem quiz: tópico não concluído e próximo é o quiz', () => {
    const e = p.estadoDoCurso(curso, prog({ telasVistas: new Set(['a', 'b']) }), INICIO);
    const t = mod(e, 'm1').topicos[0];
    assert.equal(t.telasVistas, 2); assert.equal(t.telas, 2); assert.equal(t.concluido, false);
    assert.deepEqual(e.proximo, { tipo: 'quiz', id: 't1' });
  });
  test('quiz aprovado conclui M1 e abre M2', () => {
    const e = p.estadoDoCurso(curso, prog({ telasVistas: new Set(['a', 'b']), tentativas: [quizOk('m1', 't1')] }), INICIO);
    assert.equal(mod(e, 'm1').estado, 'concluido');
    assert.equal(mod(e, 'm2').estado, 'disponivel');
    assert.equal(e.percentual, 25);
    assert.deepEqual(e.proximo, { tipo: 'tela', id: 'c' });
  });
  test('quiz aprovado sem ver as telas não conclui o tópico', () => {
    const e = p.estadoDoCurso(curso, prog({ tentativas: [quizOk('m1', 't1')] }), INICIO);
    assert.equal(mod(e, 'm1').topicos[0].concluido, false);
    assert.equal(mod(e, 'm1').estado, 'disponivel');
  });
  test('pré-teste aprovado conclui o módulo; reprovado só marca usado', () => {
    const base = { telasVistas: new Set(['a', 'b']), tentativas: [quizOk('m1', 't1')] };
    const ok = p.estadoDoCurso(curso, prog({ ...base, tentativas: [...base.tentativas, { tipo: 'PRE_TESTE', moduloId: 'm2', aprovado: true, concluidaEm: INICIO }] }), INICIO);
    assert.equal(mod(ok, 'm2').estado, 'concluido');
    const nao = p.estadoDoCurso(curso, prog({ ...base, tentativas: [...base.tentativas, { tipo: 'PRE_TESTE', moduloId: 'm2', aprovado: false, concluidaEm: INICIO }] }), INICIO);
    assert.equal(mod(nao, 'm2').preTeste, 'usado');
    assert.equal(mod(nao, 'm2').estado, 'disponivel');
  });
  test('pré-teste em aberto (sem resultado) já conta como usado', () => {
    const e = p.estadoDoCurso(curso, prog({ tentativas: [{ tipo: 'PRE_TESTE', moduloId: 'm1', aprovado: null, concluidaEm: null }] }), INICIO);
    assert.equal(mod(e, 'm1').preTeste, 'usado');
  });
  test('fronteira dos 7 dias', () => {
    const antes = p.estadoDoCurso(curso, prog(), new Date(INICIO.getTime() + 7 * DIA - 60000));
    assert.equal(mod(antes, 'm2').estado, 'bloqueado');
    assert.equal(antes.sequencial, true);
    const depois = p.estadoDoCurso(curso, prog(), new Date(INICIO.getTime() + 7 * DIA));
    assert.equal(mod(depois, 'm2').estado, 'disponivel');
    assert.equal(mod(depois, 'm3').estado, 'disponivel');
    assert.equal(depois.sequencial, false);
    assert.equal(mod(depois, 'f').estado, 'bloqueado');
  });
  test('todos os comuns concluídos abrem o final; cenário concluído conclui o curso', () => {
    const feito = { telasVistas: new Set(['a', 'b', 'c', 'd']), tentativas: [quizOk('m1', 't1'), quizOk('m2', 't2')] };
    const e = p.estadoDoCurso(semM3, prog(feito), INICIO);
    assert.equal(mod(e, 'f').estado, 'disponivel');
    assert.deepEqual(e.proximo, { tipo: 'cenario', id: 'c1' });
    const fim = p.estadoDoCurso(semM3, prog({ ...feito, cenarios: [{ cenarioId: 'c1', concluidoEm: INICIO }] }), INICIO);
    assert.equal(fim.concluido, true);
    assert.equal(fim.proximo, null);
    assert.equal(fim.percentual, 100);
  });
  test('cenário começado mas não concluído não conclui o final', () => {
    const feito = { telasVistas: new Set(['a', 'b', 'c', 'd']), tentativas: [quizOk('m1', 't1'), quizOk('m2', 't2')], cenarios: [{ cenarioId: 'c1', concluidoEm: null }] };
    assert.equal(mod(p.estadoDoCurso(semM3, prog(feito), INICIO), 'f').estado, 'disponivel');
  });
  test('módulo sem telas disponível: próximo aponta o módulo', () => {
    const e = p.estadoDoCurso({ modulos: [curso.modulos[2], curso.modulos[3]] }, prog(), INICIO);
    assert.deepEqual(e.proximo, { tipo: 'modulo', id: 'm3' });
  });
  test('pré-teste indisponível: menos de 8 ativas, módulo final, módulo concluído', () => {
    const e = p.estadoDoCurso(curso, prog({ telasVistas: new Set(['a', 'b']), tentativas: [quizOk('m1', 't1')] }), INICIO);
    assert.equal(mod(e, 'm1').preTeste, 'indisponivel'); // concluído (e só 3 ativas)
    assert.equal(mod(e, 'm2').preTeste, 'disponivel');
    assert.equal(mod(e, 'm3').preTeste, 'indisponivel');
    assert.equal(mod(e, 'f').preTeste, 'indisponivel');
  });
});

describe('sortear', () => {
  const fixo = () => 0.42;
  test('n distintos', () => {
    const r = p.sortear(['a', 'b', 'c', 'd', 'e'], 3, [], fixo);
    assert.equal(r.length, 3); assert.equal(new Set(r).size, 3);
  });
  test('evita a tentativa anterior quando dá', () => {
    const r = p.sortear(['a', 'b', 'c', 'd', 'e', 'f'], 3, ['a', 'b', 'c']);
    assert.deepEqual([...r].sort(), ['d', 'e', 'f']);
  });
  test('completa com as evitadas quando faltam', () => {
    const r = p.sortear(['a', 'b', 'c', 'd'], 3, ['a', 'b', 'c']);
    assert.equal(r.length, 3); assert.ok(r.includes('d'));
  });
  test('n maior que a lista: a lista toda', () => {
    assert.deepEqual([...p.sortear(['a', 'b'], 3)].sort(), ['a', 'b']);
  });
});

describe('tamanhoPreTeste, corrigir, aprovado', () => {
  test('tamanhoPreTeste', () => {
    assert.equal(p.tamanhoPreTeste(7), null); assert.equal(p.tamanhoPreTeste(8), 8); assert.equal(p.tamanhoPreTeste(20), 12);
  });
  const alts = [{ id: '1', correta: true }, { id: '2', correta: false }, { id: '3', correta: true }];
  test('corrigir', () => {
    assert.equal(p.corrigir([{ id: '1', correta: true }, { id: '2', correta: false }], ['1']), true);
    assert.equal(p.corrigir([{ id: '1', correta: true }, { id: '2', correta: false }], ['2']), false);
    assert.equal(p.corrigir(alts, ['1', '3']), true);
    assert.equal(p.corrigir(alts, ['1']), false);
    assert.equal(p.corrigir(alts, ['1', '2', '3']), false);
    assert.equal(p.corrigir(alts, []), false);
  });
  test('aprovado', () => {
    assert.equal(p.aprovado(2, 3, 80), false); assert.equal(p.aprovado(3, 3, 80), true); assert.equal(p.aprovado(8, 10, 80), true);
    assert.equal(p.aprovado(0, 0, 80), false);
  });
});

describe('cadastroIncompleto', () => {
  const completo = { cep: '20000000', logradouro: 'Praça', numero: '10', bairro: 'Centro', cidade: 'Rio', uf: 'RJ', escolaridade: 'Médio', escolaridadeSituacao: 'Completo' };
  test('completo', () => assert.equal(cadastroIncompleto(completo), false));
  for (const campo of Object.keys(completo)) {
    test(`falta ${campo}`, () => assert.equal(cadastroIncompleto({ ...completo, [campo]: null }), true));
  }
});
