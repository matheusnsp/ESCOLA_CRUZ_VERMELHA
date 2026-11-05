// Testes de lib/ead-teste.js (link secreto de teste). Parte com banco: só com DATABASE_URL local.
require('dotenv').config();
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const eadTeste = require('../src/lib/ead-teste');

describe('código do link de teste', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const coId = '11111111-2222-4333-8444-555555555555';
  after(async () => { await eadTeste.desligar(coId); await prisma.$disconnect(); });

  test('gerar, achar, trocar e desligar', async () => {
    assert.equal(await eadTeste.codigoDoCurso(coId), null);
    const c1 = await eadTeste.gerarCodigo(coId);
    assert.match(c1, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await eadTeste.codigoDoCurso(coId), c1);
    assert.equal(await eadTeste.cursoDoCodigo(c1), coId);
    const c2 = await eadTeste.gerarCodigo(coId);
    assert.notEqual(c2, c1);
    assert.equal(await eadTeste.cursoDoCodigo(c1), null);
    assert.equal(await eadTeste.cursoDoCodigo(c2), coId);
    await eadTeste.desligar(coId);
    assert.equal(await eadTeste.cursoDoCodigo(c2), null);
  });
});

test('código fora do formato: null sem ir ao banco', async () => {
  assert.equal(await eadTeste.cursoDoCodigo('abc'), null);
  assert.equal(await eadTeste.cursoDoCodigo("x'; DROP TABLE"), null);
});
