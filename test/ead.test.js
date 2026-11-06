// Testes das regras puras do EAD (src/lib/ead.js). Rodar: npm test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ead = require('../src/lib/ead');

const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
const ERRO_VIDEO = 'Use um link do YouTube ou do Vimeo.';

describe('normalizarVideo', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ' https://youtu.be/dQw4w9WgXcQ?si=abc ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s',
    'http://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  ]) {
    test(`YouTube: ${url.trim()}`, () => assert.deepEqual(ead.normalizarVideo(url), { url: YT }));
  }
  test('Vimeo público', () => assert.deepEqual(ead.normalizarVideo('https://vimeo.com/123456'), { url: 'https://player.vimeo.com/video/123456' }));
  test('Vimeo não listado', () => assert.deepEqual(ead.normalizarVideo('https://vimeo.com/123456/abcdef12'), { url: 'https://player.vimeo.com/video/123456?h=abcdef12' }));
  test('Vimeo player com hash', () => assert.deepEqual(ead.normalizarVideo('https://player.vimeo.com/video/123456?h=abcdef12&badge=0'), { url: 'https://player.vimeo.com/video/123456?h=abcdef12' }));
  for (const ruim of ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'https://example.com/v.mp4', 'javascript:alert(1)', '', 'https://youtu.be/curto', 'https://vimeo.com/abc', null]) {
    test(`recusa ${JSON.stringify(ruim)}`, () => assert.deepEqual(ead.normalizarVideo(ruim), { erro: ERRO_VIDEO }));
  }
});

describe('lerMmSs / mmSs', () => {
  test('2:10 → 130', () => assert.equal(ead.lerMmSs('2:10'), 130));
  test('130 → 130', () => assert.equal(ead.lerMmSs('130'), 130));
  test('vazio → null', () => assert.equal(ead.lerMmSs(''), null));
  test('2:75 → null', () => assert.equal(ead.lerMmSs('2:75'), null));
  test('abc → null', () => assert.equal(ead.lerMmSs('abc'), null));
  test('130 → "2:10"', () => assert.equal(ead.mmSs(130), '2:10'));
  test('240 → "4:00"', () => assert.equal(ead.mmSs(240), '4:00'));
});

describe('normalizarAlternativas', () => {
  const alt = (texto, correta = false) => ({ texto, correta });
  test('UNICA com 2 corretas → erro', () => assert.ok(ead.normalizarAlternativas('UNICA', [alt('a', true), alt('b', true)]).erro));
  test('UNICA com 1 preenchida → erro', () => assert.ok(ead.normalizarAlternativas('UNICA', [alt('a', true), alt('  ')]).erro));
  test('MULTIPLA sem correta → erro', () => assert.ok(ead.normalizarAlternativas('MULTIPLA', [alt('a'), alt('b')]).erro));
  test('6 preenchidas → erro', () => assert.ok(ead.normalizarAlternativas('MULTIPLA', ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => alt(t, true))).erro));
  test('vazias somem e a ordem se refaz', () => {
    assert.deepEqual(ead.normalizarAlternativas('UNICA', [alt('a'), alt(''), alt(' b ', true)]), {
      alternativas: [{ texto: 'a', correta: false, ordem: 0 }, { texto: 'b', correta: true, ordem: 1 }],
    });
  });
  test('MULTIPLA com 2 corretas passa', () => assert.equal(ead.normalizarAlternativas('MULTIPLA', [alt('a', true), alt('b', true), alt('c')]).alternativas.length, 3));
  test('VF: Falso correta', () => {
    assert.deepEqual(ead.normalizarAlternativas('VF', [alt('qualquer'), alt('coisa', true)]), {
      alternativas: [{ texto: 'Verdadeiro', correta: false, ordem: 0 }, { texto: 'Falso', correta: true, ordem: 1 }],
    });
  });
  test('VF sem correta → erro', () => assert.ok(ead.normalizarAlternativas('VF', [alt(''), alt('')]).erro));
});

// Árvore de módulo completo e válido; cada teste estraga uma coisa.
function pergunta(i, extra = {}) {
  return { enunciado: `P${i}`, tipo: 'UNICA', ativa: true, feedback: 'porque sim', alternativas: [{ texto: 'a', correta: true }, { texto: 'b', correta: false }], ...extra };
}
function tela(titulo = 'Criança no recreio', extra = {}) {
  return { titulo, ancora: 'Uma criança…', videoUrl: YT, ...extra };
}
function moduloComum() {
  return {
    titulo: 'Engasgo', introducao: 'Texto', minutosEstimados: 20, final: false, cenarios: [],
    topicos: [
      { titulo: 'Reconhecer o engasgo', telas: [tela()], perguntas: [1, 2, 3, 4].map((i) => pergunta(i)) },
      { titulo: 'Bebê', telas: [tela('Bebê')], perguntas: [5, 6, 7, 8].map((i) => pergunta(i)) },
    ],
  };
}
function moduloFinal() {
  const opcoes = [{ texto: 'OLHAR', correta: false, feedback: 'f' }, { texto: 'LIGAR', correta: false, feedback: 'f' }, { texto: 'CUIDAR', correta: true, feedback: 'f' }];
  return {
    titulo: 'Juntando tudo', introducao: 'Texto', minutosEstimados: 20, final: true, topicos: [],
    cenarios: [{ titulo: 'Pânico na hora do lanche', cena: 'Creche, 15h', decisoes: [{ pergunta: 'O que você faz primeiro?', opcoes }] }],
  };
}
const contem = (lista, trecho) => assert.ok(lista.some((p) => p.includes(trecho)), `esperava "${trecho}" em ${JSON.stringify(lista)}`);

describe('pendencias', () => {
  test('módulo comum completo → nada', () => assert.deepEqual(ead.pendencias(moduloComum()), []));
  test('módulo final completo → nada', () => assert.deepEqual(ead.pendencias(moduloFinal()), []));
  test('tópico com 2 perguntas ativas', () => {
    const m = moduloComum(); m.topicos[0].perguntas = [pergunta(1), pergunta(2), pergunta(3, { ativa: false })]; m.topicos[1].perguntas.push(pergunta(9), pergunta(10));
    const p = ead.pendencias(m);
    contem(p, "Tópico 'Reconhecer o engasgo': só 2 perguntas ativas (mínimo 3)");
  });
  test('módulo com 6 perguntas no total', () => {
    const m = moduloComum(); m.topicos[0].perguntas.pop(); m.topicos[1].perguntas.pop();
    contem(ead.pendencias(m), 'mínimo 8');
  });
  test('tela sem vídeo', () => {
    const m = moduloComum(); m.topicos[0].telas[0].videoUrl = null;
    contem(ead.pendencias(m), "Tela 'Criança no recreio'");
  });
  test('tela sem âncora', () => {
    const m = moduloComum(); m.topicos[0].telas[0].ancora = '';
    contem(ead.pendencias(m), 'âncora');
  });
  test('tópico sem tela', () => {
    const m = moduloComum(); m.topicos[1].telas = [];
    contem(ead.pendencias(m), "Tópico 'Bebê': sem telas");
  });
  test('módulo sem tópico', () => {
    const m = moduloComum(); m.topicos = [];
    contem(ead.pendencias(m), 'pelo menos 1 tópico');
  });
  test('pergunta ativa sem feedback', () => {
    const m = moduloComum(); m.topicos[0].perguntas[0].feedback = ' ';
    contem(ead.pendencias(m), 'feedback');
  });
  test('pergunta ativa com alternativas inválidas', () => {
    const m = moduloComum(); m.topicos[0].perguntas[0].alternativas = [{ texto: 'a', correta: true }, { texto: 'b', correta: true }];
    contem(ead.pendencias(m), "Pergunta 'P1'");
  });
  test('minutos 0 e sem introdução', () => {
    const m = moduloComum(); m.minutosEstimados = 0; m.introducao = null;
    const p = ead.pendencias(m);
    contem(p, 'tempo estimado'); contem(p, 'introdução');
  });
  test('final sem cenário', () => {
    const m = moduloFinal(); m.cenarios = [];
    contem(ead.pendencias(m), 'pelo menos 1 cenário');
  });
  test('decisão com 2 opções', () => {
    const m = moduloFinal(); m.cenarios[0].decisoes[0].opcoes.pop();
    contem(ead.pendencias(m), 'exatamente 3 opções');
  });
  test('decisão com 2 corretas', () => {
    const m = moduloFinal(); m.cenarios[0].decisoes[0].opcoes[0].correta = true;
    contem(ead.pendencias(m), 'exatamente 1 correta');
  });
  test('opção sem fala do instrutor', () => {
    const m = moduloFinal(); m.cenarios[0].decisoes[0].opcoes[1].feedback = '';
    contem(ead.pendencias(m), 'fala do instrutor');
  });
  test('cenário sem decisão e sem cena', () => {
    const m = moduloFinal(); m.cenarios[0].decisoes = []; m.cenarios[0].cena = '';
    const p = ead.pendencias(m);
    contem(p, 'sem decisões'); contem(p, 'sem a cena');
  });
});

describe('avisos', () => {
  test('tópico com 4 perguntas → meta 10', () => contem(ead.avisos(moduloComum()), 'meta do documento: 10'));
  test('tópicos com 10 → nada', () => {
    const m = moduloComum(); for (const t of m.topicos) t.perguntas = Array.from({ length: 10 }, (_, i) => pergunta(i));
    assert.deepEqual(ead.avisos(m), []);
  });
  test('módulo final → nada', () => assert.deepEqual(ead.avisos(moduloFinal()), []));
});

describe('esquemas', () => {
  test('notaMinimaQuiz fora de 50–100', () => {
    assert.equal(ead.schemaCursoOnline.safeParse({ notaMinimaQuiz: '40' }).success, false);
    assert.equal(ead.schemaCursoOnline.safeParse({ notaMinimaQuiz: '80' }).data.notaMinimaQuiz, 80);
  });
  test('título obrigatório e até 120', () => {
    assert.equal(ead.schemaTopico.safeParse({ titulo: '  ' }).success, false);
    assert.equal(ead.schemaTopico.safeParse({ titulo: 'x'.repeat(121) }).success, false);
  });
  test('opcional vazio vira null', () => {
    const r = ead.schemaTela.safeParse({ titulo: 'T', ancora: '', alerta: '  ' });
    assert.equal(r.success, true); assert.equal(r.data.ancora, null); assert.equal(r.data.alerta, null);
  });
  test('âncora acima de 600 recusa', () => assert.equal(ead.schemaTela.safeParse({ titulo: 'T', ancora: 'x'.repeat(601) }).success, false));
});
