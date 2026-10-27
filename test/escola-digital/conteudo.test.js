const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { validarCurso, lerPasta, resolverPasta, ehBancoLocal } = require('../../src/lib/escola-digital/conteudo');

const SUFIXO = ' (conteúdo ilustrativo, não validado)';

// Conteúdo mínimo válido; cada teste estraga uma coisa só.
function base() {
  return {
    curso: {
      nome: 'Curso de teste', descricao: 'Descrição.', cargaHoraria: 3,
      precoAvista: 79.9, precoCheio: 89.9, parcelas: 3, prazoAcessoDias: 365,
      validadeCertificadoMeses: 24, videoSubstituto: null,
    },
    modulos: [
      {
        chave: 'm1', ordem: 1, titulo: 'Módulo 1', minutos: 10, abertura: 'Abertura.', temPreTeste: true, final: false,
        topicos: [{
          chave: 't1', titulo: 'Tópico 1',
          telas: [{ chave: 'tela1', titulo: 'Tela 1', ancora: 'Âncora.', revisao: ['a', 'b', 'c', 'd'] }],
          perguntas: [
            { chave: 'p1', enunciado: 'P1?', alternativas: ['a', 'b', 'c'], correta: 1, porque: 'Porque sim.' },
          ],
        }],
      },
      {
        chave: 'm2', ordem: 2, titulo: 'Final', minutos: 20, abertura: 'Abertura.', temPreTeste: false, final: true,
        topicos: [],
        cenarios: [{
          chave: 'c1', titulo: 'Cenário', cena: 'Cena.', tempoSugerido: 240,
          decisoes: [
            { pergunta: 'Primeiro?', opcoes: ['OLHAR', 'LIGAR', 'CUIDAR'], correta: 2, fala: 'Boa.' },
            { pergunta: 'Depois?', opcoes: ['x', 'y', 'z'], correta: 0, fala: 'Certo.' },
          ],
        }],
      },
    ],
  };
}

const temErro = (erros, trecho) => erros.some((e) => e.includes(trecho));

test('conteúdo mínimo válido não tem erros', () => assert.deepEqual(validarCurso(base()), []));

test('(a) revisão com mais de 4 itens', () => {
  const d = base();
  d.modulos[0].topicos[0].telas[0].revisao.push('e');
  assert.ok(temErro(validarCurso(d), 'revisao'));
});

test('(b) correta fora das alternativas', () => {
  const d = base();
  d.modulos[0].topicos[0].perguntas[0].correta = 3;
  assert.ok(temErro(validarCurso(d), 'correta'));
  d.modulos[0].topicos[0].perguntas[0].correta = -1;
  assert.ok(temErro(validarCurso(d), 'correta'));
});

test('(c) 1ª decisão do cenário sem OLHAR, LIGAR, CUIDAR', () => {
  const d = base();
  d.modulos[1].cenarios[0].decisoes[0].opcoes = ['LIGAR', 'OLHAR', 'CUIDAR'];
  assert.ok(temErro(validarCurso(d), 'OLHAR'));
});

test('(d) chave repetida no mesmo nível', () => {
  let d = base();
  d.modulos[1].chave = 'm1';
  assert.ok(temErro(validarCurso(d), 'chave repetida'));
  d = base();
  d.modulos[0].topicos[0].perguntas.push({ ...d.modulos[0].topicos[0].perguntas[0] });
  assert.ok(temErro(validarCurso(d), 'chave repetida'));
  d = base();
  d.modulos[0].topicos[0].telas.push({ ...d.modulos[0].topicos[0].telas[0] });
  assert.ok(temErro(validarCurso(d), 'chave repetida'));
  d = base();
  d.modulos[1].cenarios.push({ ...d.modulos[1].cenarios[0] });
  assert.ok(temErro(validarCurso(d), 'chave repetida'));
});

test('(d) a mesma chave em pais diferentes é permitida', () => {
  const d = base();
  d.modulos[1].topicos = [{ ...d.modulos[0].topicos[0] }];
  assert.deepEqual(validarCurso(d), []);
});

test('(e) módulo final sem cenários', () => {
  const d = base();
  delete d.modulos[1].cenarios;
  assert.ok(temErro(validarCurso(d), 'cenários'));
  d.modulos[1].cenarios = [];
  assert.ok(temErro(validarCurso(d), 'cenários'));
});

test('alternativas: de 3 a 5', () => {
  const d = base();
  d.modulos[0].topicos[0].perguntas[0].alternativas = ['a', 'b'];
  assert.ok(temErro(validarCurso(d), 'alternativas'));
  d.modulos[0].topicos[0].perguntas[0].alternativas = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.ok(temErro(validarCurso(d), 'alternativas'));
});

test('decisão com opções diferentes de 3 ou correta fora', () => {
  const d = base();
  d.modulos[1].cenarios[0].decisoes[1].opcoes = ['x', 'y'];
  assert.ok(temErro(validarCurso(d), 'opcoes'));
  const e = base();
  e.modulos[1].cenarios[0].decisoes[1].correta = 5;
  assert.ok(temErro(validarCurso(e), 'correta'));
});

test('módulos com ordem repetida e curso sem módulos', () => {
  const d = base();
  d.modulos[1].ordem = 1;
  assert.ok(temErro(validarCurso(d), 'ordem'));
  assert.ok(validarCurso({ curso: base().curso, modulos: [] }).length > 0);
});

test('campos do curso e vídeo opcional', () => {
  let d = base();
  delete d.curso.nome;
  assert.ok(temErro(validarCurso(d), 'curso.nome'));
  d = base();
  d.curso.parcelas = 0;
  assert.ok(temErro(validarCurso(d), 'parcelas'));
  d = base();
  d.curso.videoSubstituto = 123;
  assert.ok(temErro(validarCurso(d), 'videoSubstituto'));
  d = base();
  d.modulos[0].topicos[0].telas[0].video = { id: 'abc', titulo: 'V', segundos: 130 };
  assert.deepEqual(validarCurso(d), []);
  d.modulos[0].topicos[0].telas[0].video = { id: '', titulo: 'V' };
  assert.ok(temErro(validarCurso(d), 'video'));
});

test('entrada que não é objeto não estoura', () => {
  assert.ok(validarCurso(null).length > 0);
  assert.ok(validarCurso({}).length > 0);
});

test('resolverPasta: nome simples vira conteudo/escola-digital/<nome>; caminho fica como está', () => {
  const raiz = path.resolve(__dirname, '../..');
  assert.equal(resolverPasta('primeiros-socorros'), path.join(raiz, 'conteudo', 'escola-digital', 'primeiros-socorros'));
  assert.equal(resolverPasta('/tmp/x/y'), path.resolve('/tmp/x/y'));
  assert.equal(resolverPasta('./pasta/y'), path.resolve('./pasta/y'));
});

test('ehBancoLocal só aceita localhost e 127.0.0.1', () => {
  assert.equal(ehBancoLocal('postgresql://postgres@localhost:5433/escola_ead'), true);
  assert.equal(ehBancoLocal('postgresql://u:p@127.0.0.1:5432/x'), true);
  assert.equal(ehBancoLocal('postgresql://u:p@db.supabase.co:5432/x'), false);
  assert.equal(ehBancoLocal('postgresql://u:p@localhost.evil.com:5432/x'), false);
  assert.equal(ehBancoLocal('postgresql://u:p@evil.com/localhost'), false);
  assert.equal(ehBancoLocal(''), false);
  assert.equal(ehBancoLocal(undefined), false);
  assert.equal(ehBancoLocal('lixo'), false);
});

// ---------- o conteúdo de exemplo que vai no repositório ----------
const PASTA = 'conteudo/escola-digital/primeiros-socorros';

test('conteúdo de exemplo é válido', () => assert.deepEqual(validarCurso(lerPasta(PASTA)), []));

test('conteúdo de exemplo: curso, módulos e minutos do mapa', () => {
  const { curso, modulos } = lerPasta(PASTA);
  assert.equal(curso.precoAvista, 79.9);
  assert.equal(curso.precoCheio, 89.9);
  assert.equal(curso.parcelas, 3);
  assert.equal(curso.prazoAcessoDias, 365);
  assert.equal(curso.validadeCertificadoMeses, 24);
  assert.equal(curso.cargaHoraria, 3);
  assert.equal(curso.videoSubstituto, null);
  assert.equal('chave' in curso, false);
  assert.deepEqual(modulos.map((m) => [m.ordem, m.titulo, m.minutos]), [
    [1, 'Antes de tudo', 20], [2, 'Parada cardíaca no adulto', 25],
    [3, 'Parada cardíaca na criança e no bebê', 20], [4, 'Engasgo', 20],
    [5, 'Mal súbito', 25], [6, 'Sangramento grave', 10], [7, 'Lesões e ambiente', 15],
    [8, 'Juntando tudo', 20],
  ]);
});

test('conteúdo de exemplo: módulo 4 com os exemplos A, B e C', () => {
  const m4 = lerPasta(PASTA).modulos[3];
  assert.deepEqual(m4.topicos.map((t) => t.titulo), ['Reconhecer o engasgo', 'Adulto e criança', 'Bebê']);
  const t1 = m4.topicos[0];
  assert.equal(t1.telas[0].titulo, 'Criança no recreio');
  assert.equal(t1.telas[0].revisao.length, 4);
  assert.ok(t1.telas[0].alerta);
  assert.ok(t1.perguntas.length >= 3);
  const pao = t1.perguntas.find((p) => /pedaço de pão/.test(p.enunciado));
  assert.ok(pao);
  assert.equal(pao.alternativas[pao.correta], 'Fico ao lado, incentivo a tossir e observo');
  for (const t of m4.topicos.slice(1)) { assert.equal(t.telas.length, 1); assert.equal(t.perguntas.length, 3); }
});

test('conteúdo de exemplo: módulo 8 é final com 5 cenários de 3 decisões', () => {
  const m8 = lerPasta(PASTA).modulos[7];
  assert.equal(m8.final, true);
  assert.equal(m8.temPreTeste, false);
  assert.equal(m8.cenarios.length, 5);
  assert.equal(m8.cenarios[0].titulo, 'Pânico na hora do lanche');
  for (const c of m8.cenarios) {
    assert.equal(c.decisoes.length, 3);
    assert.deepEqual(c.decisoes[0].opcoes, ['OLHAR', 'LIGAR', 'CUIDAR']);
  }
});

test('conteúdo de exemplo: módulos 1-3 e 5-7 têm 1 tópico, 1 tela e 3 perguntas; âncoras marcadas; sem vídeo de terceiros', () => {
  const { modulos } = lerPasta(PASTA);
  for (const i of [0, 1, 2, 4, 5, 6]) {
    const m = modulos[i];
    assert.equal(m.topicos.length, 1, m.titulo);
    assert.equal(m.topicos[0].telas.length, 1, m.titulo);
    assert.equal(m.topicos[0].perguntas.length, 3, m.titulo);
  }
  for (const m of modulos) for (const t of m.topicos) for (const tela of t.telas) {
    assert.ok(tela.ancora.endsWith(SUFIXO), `${m.chave}/${t.chave}/${tela.chave}`);
    assert.equal('video' in tela, false);
  }
});
