// [revisão I2, etapa 6] O curso de quem tem vaga num lote aparece na Minha conta — desde a etapa 7, na aba "Cursos online".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
test('a Minha conta mostra o curso da escola pela aba Cursos online (etapa 7: lib/ead-meus-cursos usa vagasDoAluno)', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ead-meus-cursos.js'), 'utf8'), /vagasDoAluno\(/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'painel.js'), 'utf8'), /meusCursosOnline\(/);
});
