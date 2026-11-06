// Site: o selo de requisito do curso. Curso que exige comprovante da área da saúde mostra
// "Profissionais e estudantes da saúde" no lugar da escolaridade mínima (pedido da escola, nov/2026).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vitrine = require('../src/lib/vitrine');

test('curso que exige comprovante de saúde mostra o público da saúde', () => {
  assert.equal(vitrine.requisitoCurso({ escolaridadeMinima: 'Ensino Médio', exigeComprovanteSaude: true }), 'Profissionais e estudantes da saúde');
  assert.equal(vitrine.requisitoCurso({ escolaridadeMinima: null, exigeComprovanteSaude: true }), 'Profissionais e estudantes da saúde');
});

test('os outros cursos seguem com a escolaridade mínima (ou nada)', () => {
  assert.equal(vitrine.requisitoCurso({ escolaridadeMinima: 'Ensino Médio' }), 'Ensino Médio');
  assert.equal(vitrine.requisitoCurso({ escolaridadeMinima: null }), null);
  assert.equal(vitrine.requisitoCurso(null), null);
});

test('as telas do site usam o requisito, não a escolaridade direto', () => {
  for (const v of ['curso-detalhe.ejs', 'home.ejs', 'partials/v-card-cat.ejs', 'partials/v-card.ejs']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', v), 'utf8');
    assert.doesNotMatch(src, /escolaridadeMinima/, v);
    assert.match(src, /requisitoCurso\(/, v); // nos cards, vitrine.requisitoCurso (o card recebe vitrine)
  }
});
