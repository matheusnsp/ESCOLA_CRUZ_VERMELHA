// 2026-11-13: telas novas de Cursos e Turmas, Task 2 — o que cada seção do curso grava e o que falta.
// Plano: docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/lib/curso-secoes');
const { parseDecimal, parseInteiro } = require('../src/lib/parse-form');

test('parse-form: mesmo comportamento de antes', () => {
  assert.equal(parseDecimal('150,50'), 150.5);
  assert.ok(Number.isNaN(parseDecimal('')));
  assert.equal(parseDecimal('', { opcional: true }), null);
  assert.ok(Number.isNaN(parseDecimal('-1')));
  assert.equal(parseInteiro('10', { min: 1 }), 10);
  assert.ok(Number.isNaN(parseInteiro('0', { min: 1 })));
});

test('SECOES: rótulos, botões e caminhos', () => {
  assert.deepEqual(Object.keys(S.SECOES), ['pagina', 'valores', 'certificado', 'publicacao']);
  assert.equal(S.SECOES.valores.rotulo, 'Valores');
  assert.equal(S.SECOES.valores.botao, 'Salvar valores');
  assert.equal(S.SECOES.pagina.botao, 'Salvar página');
  assert.equal(S.SECOES.certificado.botao, 'Salvar certificado');
  assert.equal(S.SECOES.publicacao.rotulo, 'Inscrição e publicação');
  assert.equal(S.SECOES.publicacao.botao, 'Salvar');
  assert.equal(S.SECOES.pagina.caminho('abc'), '/cursos/abc/pagina');
});

test('lerSecao valores: só os preços (e a parcela de referência)', () => {
  const r = S.lerSecao('valores', { precoAvista: '1200,00', precoCheio: '1350', parcelas: '10', taxaMatricula: '80', nome: 'ignorado' });
  assert.equal(r.erro, null);
  assert.deepEqual(Object.keys(r.dados).sort(), ['parcelas', 'precoAvista', 'precoCheio', 'taxaMatricula', 'valorParcela']);
  assert.equal(r.dados.valorParcela, 135);
  assert.deepEqual(r.extras, {});
  assert.equal(S.lerSecao('valores', { precoAvista: 'muito', precoCheio: '1', parcelas: '1' }).erro, 'Verifique os valores (use numeros, ex.: 150.00).');
  assert.equal(S.lerSecao('valores', { precoAvista: '1', precoCheio: '1', parcelas: 'x' }).erro, 'Numero de parcelas invalido.');
});

test('lerSecao pagina: dados do curso + área nos extras', () => {
  assert.equal(S.lerSecao('pagina', { nome: '', cargaHoraria: '8' }).erro, 'Informe o nome do curso.');
  assert.equal(S.lerSecao('pagina', { nome: 'X', cargaHoraria: 'abc' }).erro, 'Carga horaria invalida.');
  const r = S.lerSecao('pagina', { nome: ' Socorrista ', cargaHoraria: '40', descricao: 'r', descricaoLonga: 't', escolaridadeMinima: 'Ensino Médio', categoria: 'Emergência e primeiros socorros', precoAvista: '9' });
  assert.equal(r.erro, null);
  assert.deepEqual(Object.keys(r.dados).sort(), ['cargaHoraria', 'descricao', 'descricaoLonga', 'escolaridadeMinima', 'nome']);
  assert.equal(r.dados.nome, 'Socorrista');
  assert.deepEqual(r.extras, { categoria: 'Emergência e primeiros socorros' });
  assert.deepEqual(S.lerSecao('pagina', { nome: 'X', cargaHoraria: '1', categoria: 'Culinária' }).extras, { categoria: null });
});

test('lerSecao certificado e publicacao', () => {
  const c = S.lerSecao('certificado', { conteudoProgramatico: 'A\r\nB', nomeCertificado: '', certificadoValidade: '2 anos' });
  assert.deepEqual(c.dados, {});
  assert.deepEqual(c.extras, { nomeCertificado: null, conteudoProgramatico: 'A\nB', certificadoValidade: '2 anos' });
  const p = S.lerSecao('publicacao', {});
  assert.deepEqual(p.dados, { ativo: false });
  assert.deepEqual(p.extras, { exigeComprovanteSaude: null });
  assert.deepEqual(S.lerSecao('publicacao', { ativo: 'on', exigeComprovanteSaude: 'on' }), { dados: { ativo: true }, extras: { exigeComprovanteSaude: true }, erro: null });
  assert.throws(() => S.lerSecao('foto', {}), /seção desconhecida/);
});

test('secoesDosCampos: agrupa os campos do assistente pelas seções', () => {
  const r = S.secoesDosCampos({ descricaoLonga: 'x', precoAvista: '1300.00', taxaMatricula: '90.00' });
  assert.deepEqual(r.map((x) => x.secao), ['pagina', 'valores']);
  assert.deepEqual(r.map((x) => x.botao), ['Salvar página', 'Salvar valores']);
  assert.deepEqual(r[1].campos, { precoAvista: '1300.00', taxaMatricula: '90.00' });
  const d = S.secoesDosCampos({ faqs: [{ pergunta: 'P?', resposta: 'R.' }], ativo: true });
  assert.deepEqual(d.map((x) => x.secao), ['publicacao', 'duvidas']);
  assert.equal(d[1].rotulo, 'Dúvidas frequentes');
  assert.deepEqual(S.secoesDosCampos({}), []);
});

test('faltasCurso e faltasTurma', () => {
  assert.deepEqual(S.faltasCurso({ imagemUrl: null, descricaoLonga: 't', conteudoProgramatico: null, totalFaqs: 0 }), ['Foto', 'Conteúdo do certificado', 'Dúvidas frequentes']);
  assert.deepEqual(S.faltasCurso({ imagemUrl: '/x.webp', descricaoLonga: '', conteudoProgramatico: 'A', totalFaqs: 3 }), ['Texto completo']);
  const amanha = new Date(Date.now() + 86400000);
  assert.deepEqual(S.faltasTurma({ totalAulas: 0, inscritos: 9, minimoAlunos: 10, pendentes: 2, inicioPrevisto: amanha }), ['Aulas', 'Pagamentos pendentes', 'Abaixo do mínimo']);
  assert.deepEqual(S.faltasTurma({ totalAulas: 4, inscritos: 3, minimoAlunos: 10, pendentes: 0, inicioPrevisto: new Date(Date.now() - 86400000) }), []);
});
