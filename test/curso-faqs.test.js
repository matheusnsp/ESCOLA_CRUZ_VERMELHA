// 2026-11-13: seção Dúvidas frequentes do curso — editar e mudar a ordem (Task 4 do plano
// docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('dúvidas do curso', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const F = require('../src/lib/curso-faqs');
  const sfx = String(Date.now()).slice(-7);
  let curso; let outro; let f1; let f2; let f3; let fo; let srv;
  const ordem = async () => (await prisma.faqCurso.findMany({ where: { cursoId: curso.id }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] })).map((f) => f.id);

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso FAQ ${sfx}`, cargaHoraria: 8, precoAvista: 1, precoCheio: 1, valorParcela: 1 } });
    outro = await prisma.curso.create({ data: { nome: `Curso FAQ Outro ${sfx}`, cargaHoraria: 8, precoAvista: 1, precoCheio: 1, valorParcela: 1 } });
    // ordens repetidas de propósito (como as antigas): moverFaq normaliza antes
    f1 = await prisma.faqCurso.create({ data: { cursoId: curso.id, pergunta: 'P1?', resposta: 'R1', ordem: 0, criadoEm: new Date(Date.now() - 3000) } });
    f2 = await prisma.faqCurso.create({ data: { cursoId: curso.id, pergunta: 'P2?', resposta: 'R2', ordem: 0, criadoEm: new Date(Date.now() - 2000) } });
    f3 = await prisma.faqCurso.create({ data: { cursoId: curso.id, pergunta: 'P3?', resposta: 'R3', ordem: 0, criadoEm: new Date(Date.now() - 1000) } });
    fo = await prisma.faqCurso.create({ data: { cursoId: outro.id, pergunta: 'Outro?', resposta: 'R', ordem: 0 } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.locals.rotuloTurma = (s) => s;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: 'teste-faq' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'COORDENACAO', pode: () => true, usuario: { nome: 'T' } }); next(); });
    app.use(require('../src/routes/painel-cursos')({ requirePermissao: () => (q, r, n) => n(), auditar: async () => {} }));
    await new Promise((r) => { const s = app.listen(0, () => { srv = { s, url: `http://127.0.0.1:${s.address().port}` }; r(); }); });
  });
  after(async () => {
    srv.s.close();
    await prisma.faqCurso.deleteMany({ where: { cursoId: { in: [curso.id, outro.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [curso.id, outro.id] } } });
  });

  test('moverFaq: sobe, não passa do topo, não mexe em dúvida de outro curso', async () => {
    assert.equal(await F.moverFaq(curso.id, f2.id, 'subir'), true);
    assert.deepEqual(await ordem(), [f2.id, f1.id, f3.id]);
    assert.equal(await F.moverFaq(curso.id, f2.id, 'subir'), false);
    assert.deepEqual(await ordem(), [f2.id, f1.id, f3.id]);
    assert.equal(await F.moverFaq(curso.id, f3.id, 'descer'), false);
    assert.equal(await F.moverFaq(curso.id, fo.id, 'subir'), false);
    assert.equal(await F.moverFaq(curso.id, f1.id, 'descer'), true);
    assert.deepEqual(await ordem(), [f2.id, f3.id, f1.id]);
  });

  test('editarFaq: corta e recusa vazio', async () => {
    assert.deepEqual(await F.editarFaq(curso.id, f1.id, { pergunta: '  ', resposta: 'x' }), { ok: false, erro: 'Preencha a pergunta e a resposta.' });
    assert.deepEqual(await F.editarFaq(curso.id, fo.id, { pergunta: 'a', resposta: 'b' }), { ok: false, erro: 'Dúvida não encontrada.' });
    assert.deepEqual(await F.editarFaq(curso.id, f1.id, { pergunta: 'Nova pergunta?', resposta: 'r'.repeat(1500) }), { ok: true });
    const f = await prisma.faqCurso.findUnique({ where: { id: f1.id } });
    assert.equal(f.pergunta, 'Nova pergunta?');
    assert.equal(f.resposta.length, 1000);
  });

  test('tela e rotas da seção', async () => {
    const html = await (await fetch(`${srv.url}/cursos/${curso.id}/duvidas`)).text();
    assert.match(html, /Nova pergunta\?/);
    for (const a of ['editar', 'subir', 'descer', 'remover']) assert.match(html, new RegExp(`/cursos/${curso.id}/faqs/[0-9a-f-]+/${a}`));
    assert.match(html, /Adicionar dúvida/);
    assert.match(html, /← Voltar ao curso/);
    const post = (u, c) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(c).toString() });
    let r = await post(`/cursos/${curso.id}/faqs/${f3.id}/subir`, {});
    assert.equal(r.headers.get('location'), `/cursos/${curso.id}/duvidas`);
    r = await post(`/cursos/${curso.id}/faqs/${f3.id}/editar`, { pergunta: '', resposta: '' });
    assert.match(r.headers.get('location'), new RegExp(`^/cursos/${curso.id}/duvidas\\?erro=`));
    r = await post(`/cursos/${curso.id}/faqs`, { pergunta: 'Tem PIX?', resposta: 'Sim.' });
    assert.equal(r.headers.get('location'), `/cursos/${curso.id}/duvidas`);
    assert.equal((await ordem()).length, 4);
    r = await post(`/cursos/${curso.id}/faqs/${f3.id}/remover`, {});
    assert.equal(r.headers.get('location'), `/cursos/${curso.id}/duvidas`);
    assert.equal((await ordem()).length, 3);
  });
});
