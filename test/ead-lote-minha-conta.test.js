// [revisão I2] A Minha conta mostra o curso de quem tem vaga num lote (painel.js passa cursosDaEscola).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
test('painel.js e minha-conta.ejs usam vagasDoAluno/cursosDaEscola', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'painel.js'), 'utf8'), /vagasDoAluno\(/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'minha-conta.ejs'), 'utf8'), /cursosDaEscola\.forEach/);
});
