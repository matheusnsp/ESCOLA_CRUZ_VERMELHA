// Escola Digital — vitrine (fase 1, 2026-11-09), Task 1: curso gratuito, ordem e destaque da vitrine nos dados.
// Spec: docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md §3. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const publicacao = require('../src/lib/ead-publicacao');

test('temPreco: gratuito ou preço maior que zero', () => {
  assert.equal(publicacao.temPreco({ gratuito: true, precoOnline: 0 }), true);
  assert.equal(publicacao.temPreco({ precoOnline: null }), false);
  assert.equal(publicacao.temPreco({ precoOnline: 0 }), false);
  assert.equal(publicacao.temPreco({ precoOnline: 49.9 }), true);
});

test('podePublicar: curso gratuito publica sem preço; sem preço e não grátis pede preço (ou Gratuito)', () => {
  assert.deepEqual(publicacao.podePublicar({ gratuito: true, precoOnline: 0, modulos: [{ titulo: 'M', status: 'VALIDADO' }] }), []);
  assert.ok(publicacao.podePublicar({ precoOnline: null, modulos: [{ titulo: 'M', status: 'VALIDADO' }] })
    .includes('Defina o preço do curso online (ou marque Gratuito).'));
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('vitrine: dados', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const ed = require('../src/lib/escola-digital');
  const s = String(Date.now()).slice(-7);
  const req = { session: { usuarioId: `dev-vit-${s}` } };
  let cZ; let cA; let cN; let coZ; let coA; let coN; let destaqueAntes;

  before(async () => {
    destaqueAntes = await prisma.configuracao.findUnique({ where: { chave: ed.CHAVE_DESTAQUE } });
    const curso = (nome) => prisma.curso.create({ data: { nome, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    cZ = await curso(`Zeta Gratis Vitrine ${s}`); // nome alfabeticamente depois, mas ordem 0
    cA = await curso(`Alfa Pago Vitrine ${s}`);
    cN = await curso(`Nao Publicado Vitrine ${s}`);
    coZ = await prisma.cursoOnline.create({ data: { cursoId: cZ.id, precoOnline: 0, gratuito: true, publicado: true, somenteOnline: true, ordemVitrine: -1000 } });
    coA = await prisma.cursoOnline.create({ data: { cursoId: cA.id, precoOnline: 30, publicado: true, somenteOnline: true, ordemVitrine: -999, maxParcelas: 3 } });
    coN = await prisma.cursoOnline.create({ data: { cursoId: cN.id, precoOnline: 30, publicado: false, somenteOnline: true } });
  });
  after(async () => {
    await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE_DESTAQUE } });
    if (destaqueAntes) await prisma.configuracao.create({ data: { chave: destaqueAntes.chave, valor: destaqueAntes.valor } });
    ed.limparCache();
    await prisma.logAuditoria.deleteMany({ where: { atorId: req.session.usuarioId } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: [coZ.id, coA.id, coN.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [cZ.id, cA.id, cN.id] } } });
  });

  test('cursosDaEscolaDigital: inclui o grátis (Grátis = preço 0) e respeita a ordem da vitrine', async () => {
    const lista = (await ed.cursosDaEscolaDigital()).filter((c) => [cZ.id, cA.id, cN.id].includes(c.id));
    assert.deepEqual(lista.map((c) => c.id), [cZ.id, cA.id], 'grátis primeiro (ordem -1000), não publicado fora');
    assert.equal(lista[0].online.gratis, true);
    assert.equal(lista[0].online.preco, 0);
    assert.equal(lista[0].online.cursoOnlineId, coZ.id);
    assert.equal(lista[1].online.gratis, false);
    assert.equal(lista[1].online.maxParcelas, 3);
  });

  test('anexarOnline: curso grátis publicado ganha online.gratis', async () => {
    const [c] = await publicacao.anexarOnline([{ id: cZ.id }]);
    assert.deepEqual(c.online, { preco: 0, gratis: true });
    const [p] = await publicacao.anexarOnline([{ id: cA.id }]);
    assert.deepEqual(p.online, { preco: 30, gratis: false });
    const [n] = await publicacao.anexarOnline([{ id: cN.id }]);
    assert.equal(n.online, null);
  });

  test('destaque: grava, lê, recusa não publicado, volta ao automático', async () => {
    assert.deepEqual(await ed.definirDestaque(coA.id, req), {});
    assert.equal(await ed.lerDestaque(), coA.id);
    assert.deepEqual(await ed.definirDestaque(coN.id, req), { erro: 'Escolha um curso online publicado.' });
    assert.equal(await ed.lerDestaque(), coA.id);
    assert.deepEqual(await ed.definirDestaque('nao-e-id', req), { erro: 'Escolha um curso online publicado.' });
    assert.deepEqual(await ed.definirDestaque(null, req), {});
    assert.equal(await ed.lerDestaque(), null);
    assert.ok(await prisma.logAuditoria.count({ where: { atorId: req.session.usuarioId, acao: 'ESCOLA_DIGITAL_DESTAQUE' } }) >= 2);
  });
});
