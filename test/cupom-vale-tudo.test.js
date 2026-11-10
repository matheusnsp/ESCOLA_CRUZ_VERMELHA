// Cupom "Tudo" (2026-11-10): vale em cursos online, e-books e presenciais. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('formulário: opção "Tudo" e rótulo claro do "todos online"', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'ead', 'cupom-form.ejs'), 'utf8');
  assert.match(h, /value="tudo"/);
  assert.match(h, /não vale no presencial/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('cupom vale tudo', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cupons = require('../src/lib/ead-cupom');
  const s = String(Date.now()).slice(-7);
  let cursoA; let co; let ebook; const ids = [];
  before(async () => {
    cursoA = await prisma.curso.create({ data: { nome: `Presencial Tudo ${s}`, cargaHoraria: 8, precoAvista: 500, precoCheio: 600, valorParcela: 100 } });
    const cOn = await prisma.curso.create({ data: { nome: `Online Tudo ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: cOn.id, precoOnline: 100 } });
    const cEb = await prisma.curso.create({ data: { nome: `Ebook Tudo ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    ebook = await prisma.ebook.create({ data: { cursoId: cEb.id, precoOnline: 50 } });
  });
  after(async () => {
    await prisma.cupomEad.deleteMany({ where: { id: { in: ids } } });
    await prisma.ebook.delete({ where: { id: ebook.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.deleteMany({ where: { id: { in: [cursoA.id, co.cursoId, ebook.cursoId] } } });
  });

  test('criarCupom com alvo "tudo" grava valeTudo e nada mais; a lista mostra o rótulo', async () => {
    const r = await cupons.criarCupom({ codigo: 'TUDO' + s, tipo: 'PERCENTUAL', valor: 10, alvo: 'tudo' }, 'teste');
    assert.ok(r.cupom, r.erro); ids.push(r.cupom.id);
    assert.equal(r.cupom.valeTudo, true);
    assert.equal(r.cupom.todosPresenciais, false);
    assert.equal(r.cupom.cursoOnlineId, null); assert.equal(r.cupom.ebookId, null); assert.equal(r.cupom.cursoId, null);
    const lista = await cupons.listarCupons();
    assert.equal(lista.find((c) => c.id === r.cupom.id).curso, 'Tudo (online, e-books e presenciais)');
  });

  test('validarCupom: "tudo" vale no presencial, no online e no e-book; "todos online" segue sem valer no presencial', async () => {
    const pres = await cupons.validarCupom('TUDO' + s, cursoA, { presencial: true, preco: 500 });
    assert.equal(pres.precoFinal, 450); assert.equal(pres.desconto, 50);
    assert.equal((await cupons.validarCupom('TUDO' + s, co)).precoFinal, 90);
    assert.equal((await cupons.validarCupom('TUDO' + s, ebook, { ebook: true })).precoFinal, 45);
    const g = await cupons.criarCupom({ codigo: 'SOON' + s, tipo: 'PERCENTUAL', valor: 10, alvo: '' }, 'teste');
    ids.push(g.cupom.id);
    assert.equal((await cupons.validarCupom('SOON' + s, cursoA, { presencial: true, preco: 500 })).erro, cupons.MSG.outroCurso);
    assert.equal((await cupons.validarCupom('SOON' + s, co)).precoFinal, 90);
  });

  test('alterar o alvo para "tudo" ou de "tudo" para outro: livre sem uso; mesmoAlvo considera valeTudo', async () => {
    const c = await prisma.cupomEad.findUnique({ where: { codigo: 'TUDO' + s } });
    const r = await cupons.alterarCupom(c.id, { codigo: c.codigo, tipo: c.tipo, valor: 10, alvo: 'presenciais' }, 'teste');
    assert.ok(r.cupom, r.erro);
    assert.equal(r.cupom.valeTudo, false); assert.equal(r.cupom.todosPresenciais, true);
    const r2 = await cupons.alterarCupom(c.id, { codigo: c.codigo, tipo: c.tipo, valor: 10, alvo: 'tudo' }, 'teste');
    assert.equal(r2.cupom.valeTudo, true); assert.equal(r2.cupom.todosPresenciais, false);
  });
});
