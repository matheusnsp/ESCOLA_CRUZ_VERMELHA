// Página do módulo (2026-11-09): a foto de abertura vai para o topo, como fundo do título (com véu escuro); o quadro
// "Antes de começar" fica só com o texto. Sem foto, o topo continua escuro. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('módulo: foto no topo', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eadTeste = require('../src/lib/ead-teste');
  const s = String(Date.now()).slice(-7);
  let server; let base; let curso; let co; let comFoto; let semFoto;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE foto topo ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    comFoto = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Com foto', ordem: 0, fotoIntroUrl: '/uploads/topo-teste.webp', introducao: 'Texto de abertura.' } });
    semFoto = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Sem foto', ordem: 1, introducao: 'Outro texto.' } });
    for (const m of [comFoto, semFoto]) await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', telas: { create: [{ titulo: 't' }] } } });
    const codigo = await eadTeste.gerarCodigo(co.id);
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/ead-teste/${codigo}`;
  });
  after(async () => {
    server.close();
    await eadTeste.desligar(co.id);
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  test('com foto: a imagem é o fundo do topo e não aparece no quadro "Antes de começar"', async () => {
    const html = await (await fetch(`${base}/modulo/${comFoto.id}`)).text();
    const topo = (html.match(/<section class="ea-heroi[^"]*"[\s\S]*?<\/section>/) || [''])[0];
    assert.match(topo, /<img src="\/uploads\/topo-teste\.webp"/);
    const prosa = (html.match(/<article class="ea-prosa"[\s\S]*?<\/article>/) || [''])[0];
    assert.doesNotMatch(prosa, /<img/);
    assert.match(prosa, /Texto de abertura\./);
  });

  test('sem foto: o topo continua escuro, sem imagem', async () => {
    const html = await (await fetch(`${base}/modulo/${semFoto.id}`)).text();
    const topo = (html.match(/<section class="ea-heroi[^"]*"[\s\S]*?<\/section>/) || [''])[0];
    assert.doesNotMatch(topo, /<img/);
  });
});
