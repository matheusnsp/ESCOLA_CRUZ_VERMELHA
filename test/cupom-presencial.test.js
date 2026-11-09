// Cupom no curso presencial (2026-11-09): validação, formulário, lista e valores com desconto. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('aba Cupons também no modo Presencial do painel', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'header.ejs'), 'utf8');
  assert.equal((h.match(/href="\/ead\/cupons"/g) || []).length, 2);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('cupom presencial', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cupons = require('../src/lib/ead-cupom');
  const s = String(Date.now()).slice(-7);
  let cursoA; let cursoB; let co; const ids = [];
  const cupom = async (codigo, extra) => { const c = await prisma.cupomEad.create({ data: { codigo: codigo + s, tipo: 'PERCENTUAL', valor: 20, criadoPor: 'teste', ...extra } }); ids.push(c.id); return c; };
  before(async () => {
    cursoA = await prisma.curso.create({ data: { nome: `Presencial A ${s}`, cargaHoraria: 8, precoAvista: 500, precoCheio: 600, valorParcela: 100 } });
    cursoB = await prisma.curso.create({ data: { nome: `Presencial B ${s}`, cargaHoraria: 8, precoAvista: 300, precoCheio: 300, valorParcela: 100 } });
    const cOn = await prisma.curso.create({ data: { nome: `Online C ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: cOn.id, precoOnline: 100 } });
    await cupom('PRA', { cursoId: cursoA.id });
    await cupom('TODP', { todosPresenciais: true });
    await cupom('GERAL', {});
  });
  after(async () => {
    await prisma.cupomEad.deleteMany({ where: { id: { in: ids } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.deleteMany({ where: { id: { in: [cursoA.id, cursoB.id, co.cursoId] } } });
  });

  test('validarCupom presencial: curso certo, todos os presenciais, recusas', async () => {
    const v = await cupons.validarCupom('PRA' + s, cursoA, { presencial: true, preco: 500 });
    assert.equal(v.precoFinal, 400); assert.equal(v.desconto, 100);
    assert.equal((await cupons.validarCupom('PRA' + s, cursoB, { presencial: true, preco: 300 })).erro, cupons.MSG.outroCurso);
    assert.equal((await cupons.validarCupom('TODP' + s, cursoB, { presencial: true, preco: 300 })).precoFinal, 240);
    assert.equal((await cupons.validarCupom('GERAL' + s, cursoA, { presencial: true, preco: 500 })).erro, cupons.MSG.outroCurso, 'cupom "todos" antigo não vale no presencial');
    assert.equal((await cupons.validarCupom('PRA' + s, co)).erro, cupons.MSG.outroCurso, 'presencial não vale no online');
    assert.equal((await cupons.validarCupom('TODP' + s, co)).erro, cupons.MSG.outroCurso);
    assert.equal((await cupons.validarCupom('GERAL' + s, co)).precoFinal, 80, 'o geral continua valendo no online');
  });

  test('formulário: alvo presencial grava cursoId; "presenciais" grava todosPresenciais; lista com rótulos', async () => {
    const a = cupons.lerDados({ codigo: 'X' + s, tipo: 'PERCENTUAL', valor: '10', alvo: `presencial:${cursoA.id}` });
    assert.equal(a.dados.cursoId, cursoA.id); assert.equal(a.dados.todosPresenciais, false); assert.equal(a.dados.cursoOnlineId, null);
    const b = cupons.lerDados({ codigo: 'X' + s, tipo: 'PERCENTUAL', valor: '10', alvo: 'presenciais' });
    assert.equal(b.dados.todosPresenciais, true); assert.equal(b.dados.cursoId, null);
    const lista = await cupons.listarCupons({});
    assert.equal(lista.find((c) => c.codigo === 'PRA' + s).curso, `Presencial: ${cursoA.nome}`);
    assert.equal(lista.find((c) => c.codigo === 'TODP' + s).curso, 'Todos os cursos presenciais');
  });
});
