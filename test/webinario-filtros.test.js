// Webinários (2026-11-13): o curso escondido do webinário fica fora das listas de cursos, como o do e-book.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('listas que leem Curso direto filtram também o webinário (webinario: null)', () => {
  assert.match(ler('src/routes/ead.js'), /where: \{ online: null, ebook: null, webinario: null \}/, 'cursos sem EAD (ativar EAD)');
  assert.match(ler('src/lib/planilha-ao-vivo.js'), /where: \{ ebook: null, webinario: null \}/, 'planilha ao vivo');
  assert.match(ler('src/routes/cursos.js'), /where: \{ ebook: null, webinario: null \}, select: \{ id: true, nome: true, ativo: true \}/, 'endereços /cursos/<x>');
  assert.match(ler('src/lib/assistente-ferramentas.js'), /where: \{ ebook: null, webinario: null \}/, 'assistente: listar_cursos');
  assert.match(ler('src/server.js'), /curso: \{ ebook: null, webinario: null \}/, 'link Cursos online do menu');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('semSoOnline / ehSoOnline com webinário', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cso = require('../src/lib/ead-curso-online');
  let w;
  before(async () => { w = (await require('../src/lib/webinario').salvar({ nome: `Filtro webinário ${Date.now()}`, gratuito: '1', duracaoMin: '60' })).webinario; });
  after(async () => { await require('../src/lib/webinario').excluir(w.id); await prisma.$disconnect(); });
  test('o curso do webinário sai das listas do presencial', async () => {
    const lista = await prisma.curso.findMany({ select: { id: true, nome: true } });
    assert.ok(lista.some((c) => c.id === w.cursoId));
    assert.ok(!(await cso.semSoOnline(lista)).some((c) => c.id === w.cursoId));
    assert.equal(await cso.ehSoOnline(w.cursoId), true);
    const curso = await prisma.curso.findUnique({ where: { id: w.cursoId } });
    assert.equal(curso.ativo, false);
    assert.equal(curso.cargaHoraria, 1);
  });
});
