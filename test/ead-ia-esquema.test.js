// Etapa 9: esquemas JSON enviados à IA, validação das respostas e do roteiro editado, e custo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/lib/ead-ia-esquema');
const { roteiroBom, moduloBom, alternativas } = require('./helpers/ia-falso');

const copia = (x) => JSON.parse(JSON.stringify(x));

test('validarRoteiro aceita um roteiro bom', () => {
  const r = E.validarRoteiro(roteiroBom(3));
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.roteiro.modulos.length, 3);
});

test('[Review Focus 3] validarRoteiro recusa com a mensagem exata', () => {
  const casos = [
    [roteiroBom(1), 'O roteiro precisa de 2 a 12 módulos.'],
    [roteiroBom(13), 'O roteiro precisa de 2 a 12 módulos.'],
    [(() => { const r = roteiroBom(3); r.modulos[0].topicos = []; return r; })(), 'Cada módulo precisa de 1 a 6 tópicos.'],
    [(() => { const r = roteiroBom(3); r.modulos[0].final = true; return r; })(), 'Só o último módulo pode ser o final.'],
    [(() => { const r = roteiroBom(3); r.modulos[1].final = true; r.modulos[1].cenarios = r.modulos[2].cenarios; return r; })(), 'Só o último módulo pode ser o final.'],
    [(() => { const r = roteiroBom(3); r.modulos[2].cenarios = [{ titulo: 'Só um' }]; return r; })(), 'O módulo final precisa de 2 a 4 cenários.'],
    [(() => { const r = roteiroBom(3); r.modulos[0].topicos[0].titulo = '  '; return r; })(), 'Todo módulo e tópico precisa de título.'],
  ];
  for (const [r, msg] of casos) assert.deepEqual(E.validarRoteiro(r), { ok: false, erro: msg });
});

test('validarModulo aceita um módulo bom (comum e final)', () => {
  const r = roteiroBom(3);
  for (const m of r.modulos) assert.equal(E.validarModulo(moduloBom(m), m).ok, true, E.validarModulo(moduloBom(m), m).erro);
});

test('[Review Focus 2] validarModulo recusa resposta que quebra as regras', () => {
  const r = roteiroBom(3); const comum = r.modulos[0]; const final = r.modulos[2];
  const ruim = (alterar, m = comum) => { const x = copia(moduloBom(m)); alterar(x); return E.validarModulo(x, m); };
  assert.equal(ruim((x) => { x.topicos[0].perguntas[0].alternativas[1].correta = true; x.topicos[0].perguntas[0].alternativas[0].correta = true; x.topicos[0].perguntas[0].alternativas[2].correta = false; x.topicos[0].perguntas[0].alternativas[3].correta = false; }).ok, false, '2 corretas');
  assert.equal(ruim((x) => { x.topicos[0].perguntas[0].alternativas.forEach((a) => { a.correta = false; }); }).ok, false, '0 corretas');
  assert.equal(ruim((x) => { x.topicos[0].perguntas[0].alternativas = alternativas().slice(0, 3); }).ok, false, '3 alternativas');
  assert.equal(ruim((x) => { x.topicos[0].perguntas = x.topicos[0].perguntas.slice(0, 2); }).ok, false, '2 perguntas no tópico');
  assert.equal(ruim((x) => { x.topicos.forEach((t) => { t.perguntas = t.perguntas.slice(0, 3); }); x.topicos[0].perguntas = x.topicos[0].perguntas.slice(0, 3); x.topicos = x.topicos.slice(0, 3); x.topicos[2].perguntas = x.topicos[2].perguntas.slice(0, 1); }).ok, false, 'menos de 8 perguntas');
  assert.equal(ruim((x) => { x.topicos.pop(); }).ok, false, 'tópicos diferentes do roteiro');
  assert.equal(ruim((x) => { x.cenarios[0].decisoes[0].opcoes.forEach((o) => { o.correta = false; }); }, final).ok, false, 'decisão sem opção correta');
  assert.equal(ruim((x) => { x.cenarios[0].tempoSugeridoSeg = 30; }, final).ok, false, 'tempo fora de 60 a 900');
});

test('custoUsd usa os preços do Opus 5.5', () => {
  assert.equal(E.custoUsd({ input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }), 29.2);
  assert.equal(E.custoUsd({ input_tokens: 1000, output_tokens: 2000 }), 0.044);
});

test('roteiroDoFormulario: reordena por ordem[] e tira módulo removido', () => {
  const body = {
    modulos: [
      { titulo: 'A', minutos: '10', topicos: ['A1', ' ', 'A2'] },
      { titulo: 'B', minutos: '15', topicos: ['B1'], remover: '1' },
      { titulo: 'Final', minutos: '20', final: '1', topicos: ['F1'], cenarios: ['C1', 'C2', ''] },
      { titulo: 'C', minutos: '5', topicos: ['C1'] },
    ],
    ordem: ['3', '0', '2'],
  };
  const r = E.roteiroDoFormulario(body);
  assert.deepEqual(r.modulos.map((m) => m.titulo), ['C', 'A', 'Final']);
  assert.deepEqual(r.modulos[1].topicos, [{ titulo: 'A1' }, { titulo: 'A2' }]);
  assert.equal(r.modulos[2].final, true);
  assert.deepEqual(r.modulos[2].cenarios, [{ titulo: 'C1' }, { titulo: 'C2' }]);
  assert.equal(r.modulos[0].minutos, 5);
});

test('esquemas: additionalProperties false em todo objeto, e required com todas as propriedades', () => {
  const visitar = (no, caminho) => {
    if (!no || typeof no !== 'object') return;
    const tipos = [].concat(no.type || []);
    if (tipos.includes('object')) {
      assert.equal(no.additionalProperties, false, caminho);
      assert.deepEqual([...no.required].sort(), Object.keys(no.properties).sort(), caminho);
    }
    for (const [k, v] of Object.entries(no.properties || {})) visitar(v, `${caminho}.${k}`);
    if (no.items) visitar(no.items, `${caminho}[]`);
  };
  visitar(E.ESQUEMA_ROTEIRO, 'roteiro');
  visitar(E.ESQUEMA_MODULO, 'modulo');
});
