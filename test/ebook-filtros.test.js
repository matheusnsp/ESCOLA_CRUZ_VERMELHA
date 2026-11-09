// E-books (2026-11-09): o curso escondido do e-book fica fora das listas de cursos. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('listas que leem Curso direto filtram o e-book (ebook: null)', () => {
  assert.match(ler('src/routes/ead.js'), /prisma\.curso\.findMany\(\{ where: \{ online: null, ebook: null \}/, 'cursos sem EAD (ativar EAD)');
  assert.match(ler('src/lib/planilha-ao-vivo.js'), /prisma\.curso\.findMany\(\{\s*where: \{ ebook: null \}/, 'planilha ao vivo');
  assert.match(ler('src/routes/cursos.js'), /prisma\.curso\.findMany\(\{ where: \{ ebook: null \}, select: \{ id: true, nome: true, ativo: true \}/, 'endereços /cursos/<x>');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('semSoOnline / ehSoOnline com e-book', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cso = require('../src/lib/ead-curso-online');
  let ebook;
  before(async () => { ebook = (await require('../src/lib/ebook').salvar({ nome: `Filtro e-book ${Date.now()}`, gratuito: '1' })).ebook; });
  after(async () => {
    await prisma.ebook.delete({ where: { id: ebook.id } });
    await prisma.curso.delete({ where: { id: ebook.cursoId } });
  });
  test('o curso do e-book sai das listas do presencial e não recebe turma', async () => {
    const lista = await prisma.curso.findMany({ select: { id: true, nome: true } });
    assert.ok(lista.some((c) => c.id === ebook.cursoId));
    assert.ok(!(await cso.semSoOnline(lista)).some((c) => c.id === ebook.cursoId));
    assert.equal(await cso.ehSoOnline(ebook.cursoId), true);
  });
});
