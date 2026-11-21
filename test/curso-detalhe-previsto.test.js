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

  // 2026-11-10 (e018642): o título do card virou o dia da semana ("Quinta-feira"); a data fica no quadrado vermelho.
  test('próxima turma: título com o dia da semana, sem repetir a data; contagem "Previsto em"; sem "Início em" nem "Começa em"', async () => {
    const html = await (await fetch(site + vitrine.urlCurso(curso))).text();
    assert.match(html, /<strong>(Segunda|Terça|Quarta|Quinta|Sexta)-feira|<strong>(Sábado|Domingo)/);
    assert.doesNotMatch(html, /<strong>Previsto para \d/);
    assert.match(html, /<span class="v-contagem-rot">Previsto em<\/span>/);
    assert.doesNotMatch(html, /Início em|Começa em/);
  });

  // 2026-11-21: a turma de várias aulas aparecia como "1 encontro" (a página só carregava a primeira aula).
  // O card usa a primeira aula (data, dia da semana, contagem), não o "início previsto", que pode estar diferente.
  test('turma com 13 aulas às sextas (início previsto num sábado): "Sextas-feiras · 13 encontros", data 15, lista das aulas', async () => {
    const curso2 = await prisma.curso.create({ data: { nome: `Curso Encontros ${s}`, cargaHoraria: 100, precoAvista: 900, precoCheio: 990, valorParcela: 100, ativo: true } });
    try {
      const aulas = [];
      for (let i = 0; i < 13; i++) aulas.push({ data: new Date(Date.UTC(2027, 0, 15 + 7 * i)), horario: '09:00 – 17:00' }); // sextas de 15/01 a 09/04
      await prisma.turma.create({ data: { cursoId: curso2.id, inicioPrevisto: new Date('2027-01-09T12:00:00-03:00'), status: 'ABERTA', aulas: { create: aulas } } });
      require('../src/lib/cache-rapido').limparTudo(); // o mapa de endereços dos cursos foi guardado no teste anterior
      const html = await (await fetch(site + vitrine.urlCurso(curso2))).text();
      assert.match(html, /<strong>Sextas-feiras · 13 encontros<\/strong>/);
      assert.match(html, /<b>15<\/b><span>janeiro<\/span>/);
      assert.doesNotMatch(html, /<b>09<\/b><span>janeiro/);
      assert.match(html, /Aulas: 15\/01, 22\/01, 29\/01, 05\/02, 12\/02, 19\/02, 26\/02, 05\/03, 12\/03, 19\/03, 26\/03, 02\/04, 09\/04</);
      assert.match(html, /data-inicio="2027-01-15T12:00:00.000Z"/); // 09:00 de Brasília da primeira aula
      assert.doesNotMatch(html, /1 encontro</);
    } finally {
      await prisma.turma.deleteMany({ where: { cursoId: curso2.id } });
      await prisma.curso.delete({ where: { id: curso2.id } });
    }
  });

  test('aulas com horários diferentes: cada data sai com o seu horário e o horário único some da linha do endereço', async () => {
    const curso3 = await prisma.curso.create({ data: { nome: `Curso Horarios ${s}`, cargaHoraria: 12, precoAvista: 300, precoCheio: 330, valorParcela: 100, ativo: true } });
    try {
      const aulas = [{ data: new Date(Date.UTC(2027, 1, 6)), horario: '09:00 – 17:00' }, { data: new Date(Date.UTC(2027, 1, 13)), horario: '13:00 – 17:00' }, { data: new Date(Date.UTC(2027, 1, 20)), horario: '09:00 – 13:00' }];
      await prisma.turma.create({ data: { cursoId: curso3.id, inicioPrevisto: new Date('2027-02-06T12:00:00-03:00'), status: 'ABERTA', aulas: { create: aulas } } });
      require('../src/lib/cache-rapido').limparTudo();
      const html = await (await fetch(site + vitrine.urlCurso(curso3))).text();
      assert.match(html, /<strong>Sábados · 3 encontros<\/strong>/);
      assert.match(html, /Aulas: 06\/02 09:00 – 17:00, 13\/02 13:00 – 17:00, 20\/02 09:00 – 13:00</);
      assert.match(html, /<span>Praça da Cruz Vermelha, 10 · Centro<\/span>/);
      assert.match(html, /horário varia por aula/);
    } finally {
      await prisma.turma.deleteMany({ where: { cursoId: curso3.id } });
      await prisma.curso.delete({ where: { id: curso3.id } });
    }
  });
});
