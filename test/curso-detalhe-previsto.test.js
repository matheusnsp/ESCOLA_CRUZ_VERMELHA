// Página do curso presencial (2026-11-09): a próxima turma diz "Previsto para <data>" e a contagem "Previsto em"
// (antes "Início em" e "Começa em"; a data é prevista e pode mudar). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('página do curso: "Previsto"', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const vitrine = require('../src/lib/vitrine');
  const s = String(Date.now()).slice(-7);
  let server; let site; let curso;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Previsto ${s}`, cargaHoraria: 8, precoAvista: 150, precoCheio: 180, valorParcela: 60, ativo: true } });
    await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: new Date(Date.now() + 10 * 864e5), status: 'ABERTA' } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = vitrine.urlCurso;
    app.locals.requisitoCurso = vitrine.requisitoCurso;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo' }); next(); });
    app.use(require('../src/routes/cursos'));
    app.use((r, res) => res.status(404).send('404'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  test('próxima turma: "Previsto para" e contagem "Previsto em"; sem "Início em" nem "Começa em"', async () => {
    const html = await (await fetch(site + vitrine.urlCurso(curso))).text();
    assert.match(html, /<strong>Previsto para \d{1,2} de [a-zç]+ de \d{4}<\/strong>/);
    assert.match(html, /<span class="v-contagem-rot">Previsto em<\/span>/);
    assert.doesNotMatch(html, /Início em|Começa em/);
  });
});
