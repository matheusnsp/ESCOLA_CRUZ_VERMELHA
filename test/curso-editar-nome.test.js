// Painel: o link de editar curso usa o nome do curso, como o site (/cursos/<nome>/editar em vez de /cursos/<id>/editar).
// O link antigo com o id continua valendo: redireciona para o endereço pelo nome.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const vitrine = require('../src/lib/vitrine');

test('urlEditarCurso: o nome do curso no endereço do painel', () => {
  assert.equal(vitrine.urlEditarCurso({ nome: 'Cuidador de Idosos (Curso Livre)' }), '/cursos/cuidador-de-idosos-curso-livre/editar');
});

test('nenhum link de editar curso é montado com o id do curso', () => {
  const arquivos = ['src/views/admin/cursos.ejs', 'src/views/admin/turma-certificados.ejs', 'src/views/admin/comprovantes-saude.ejs', 'src/lib/certificado.js', 'src/routes/admin.js'];
  for (const a of arquivos) {
    const src = fs.readFileSync(path.join(__dirname, '..', a), 'utf8');
    assert.doesNotMatch(src, /\/cursos\/(\$\{|<%= )[^`'"\n}%]*(\.id|params\.id)\s*(\}|%>)\/editar/, a);
  }
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('cursosPeloEndereco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { cursosPeloEndereco } = require('../src/lib/curso-endereco');
  const s = String(Date.now()).slice(-7);
  const criados = [];
  const novo = (nome, extra = {}) => prisma.curso.create({ data: { nome, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ...extra } }).then((c) => { criados.push(c.id); return c; });

  before(async () => {
    await novo(`Curso Único Endereço ${s}`);
    await novo(`Curso Repetido ${s}`, { ativo: false });
    await novo(`Curso repetido ${s}`);
  });
  after(async () => {
    await prisma.curso.deleteMany({ where: { id: { in: criados } } });
    await prisma.$disconnect();
  });

  test('acha o curso pelo nome, sem acento nem maiúscula', async () => {
    const r = await cursosPeloEndereco(`curso-unico-endereco-${s}`);
    assert.equal(r.length, 1);
    assert.equal(r[0].nome, `Curso Único Endereço ${s}`);
  });

  test('endereço que não existe: lista vazia', async () => {
    assert.deepEqual(await cursosPeloEndereco(`nao-existe-${s}`), []);
  });

  test('dois cursos com o mesmo endereço: devolve os dois, o ativo primeiro', async () => {
    const r = await cursosPeloEndereco(`curso-repetido-${s}`);
    assert.equal(r.length, 2);
    assert.equal(r[0].ativo, true);
  });
});
