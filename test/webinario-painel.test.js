// Webinários (2026-11-13; spec §2): painel modo Online → Webinários (src/routes/ead-webinarios.js). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { ouvir } = require('./helpers/painel-ead');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('painel de webinários', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const email = require('../src/lib/email');
  const s = String(Date.now()).slice(-7);
  const auditados = []; const enviados = [];
  let srv; let orig; let aluno;

  const form = (campos) => { const f = new FormData(); for (const [k, v] of Object.entries({ _csrf: 'x', ...campos })) f.append(k, v); return f; };
  const enviar = (u, campos) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', body: form(campos) });
  const post = (u, dados = {}) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', ...dados }) });
  const get = async (u) => (await fetch(srv.url + u)).text();
  const meus = () => prisma.webinario.findMany({ where: { curso: { nome: { contains: s } } }, include: { curso: true }, orderBy: { criadoEm: 'asc' } });

  before(async () => {
    orig = { g: email.enviarWebinarGravacao, h: email.enviarWebinarNovoHorario };
    email.enviarWebinarGravacao = async (e, n, d) => { enviados.push(['gravacao', e]); };
    email.enviarWebinarNovoHorario = async (e, n, d) => { enviados.push(['horario', e, !!d.ics]); };
    aluno = await prisma.usuario.create({ data: { nome: 'Aluna Webinário', email: `aw-${s}@teste.local`, papel: 'ALUNO' } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: 'dev-w' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: 'dev-w' }, modo: 'online' }); next(); });
    app.use(require('../src/routes/ead-webinarios')({ requireDev: (req, res, next) => next(), auditar: async (req, acao) => { auditados.push(acao); } }));
    srv = await ouvir(app);
  });
  after(async () => {
    srv.server.close();
    Object.assign(email, { enviarWebinarGravacao: orig.g, enviarWebinarNovoHorario: orig.h });
    await prisma.usuario.delete({ where: { id: aluno.id } }).catch(() => {});
    for (const w of await meus()) await wb.excluir(w.id);
    await prisma.$disconnect();
  });

  test('criar rascunho, lista, publicar sem palavra recusa, ordem ↑↓', async () => {
    let r = await enviar('/ead/webinarios/novo', { nome: `Engasgo em bebês ${s}`, duracaoMin: '60', gratuito: '1', inicioEm: '2030-01-10T19:00' });
    assert.equal(r.status, 302);
    r = await enviar('/ead/webinarios/novo', { nome: `Queimaduras ${s}`, duracaoMin: '45', preco: '29,90' });
    assert.equal(r.status, 302);
    assert.deepEqual(auditados.filter((a) => a === 'CRIOU_WEBINARIO').length, 2);
    let html = await get('/ead/webinarios');
    assert.match(html, new RegExp(`Engasgo em bebês ${s}`));
    assert.match(html, /Rascunho/);
    assert.match(html, /10\/01\/2030 às 19h/);
    assert.match(html, /Grátis/);
    const [a, b] = await meus();
    r = await enviar(`/ead/webinarios/${a.id}`, { nome: a.curso.nome, duracaoMin: '60', gratuito: '1', publicado: '1', inicioEm: '2030-01-10T19:00' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Para publicar, defina a palavra-código\./);
    const antes = (await meus()).map((w) => w.id);
    await post(`/ead/webinarios/ordem/${b.id}/cima`);
    const depois = (await prisma.webinario.findMany({ where: { id: { in: antes } }, orderBy: [{ ordemVitrine: 'asc' }, { criadoEm: 'asc' }] })).map((w) => w.id);
    assert.equal(depois.indexOf(b.id) < depois.indexOf(a.id), true);
  });

  test('inscritos: lista, forma e presença; CSV', async () => {
    const [a] = await meus();
    await prisma.inscricaoWebinario.create({ data: { webinarioId: a.id, usuarioId: aluno.id } });
    await prisma.presencaWebinario.create({ data: { webinarioId: a.id, usuarioId: aluno.id } });
    const html = await get(`/ead/webinarios/${a.id}/inscritos`);
    assert.match(html, /Aluna Webinário/);
    assert.match(html, new RegExp(`aw-${s}@teste.local`));
    assert.match(html, /Grátis/);
    const csv = await (await fetch(`${srv.url}/ead/webinarios/${a.id}/inscritos.csv`)).text();
    assert.match(csv.split('\n')[0], /^﻿?Nome;E-mail;Inscrito em;Forma;Presença/);
    assert.match(csv, /Aluna Webinário;aw-.*;Grátis;Sim/);
  });

  test('excluir com inscrição pede para despublicar; mudar horário avisa e zera lembretes; gravação nova avisa uma vez', async () => {
    const [a] = await meus();
    const r = await post(`/ead/webinarios/${a.id}/excluir`);
    assert.match(decodeURIComponent(r.headers.get('location')), /despublique/);
    await prisma.inscricaoWebinario.updateMany({ where: { webinarioId: a.id }, data: { lembrete24hEm: new Date(), lembrete1hEm: new Date() } });
    await enviar(`/ead/webinarios/${a.id}`, { nome: a.curso.nome, duracaoMin: '60', gratuito: '1', inicioEm: '2030-01-12T19:00' });
    const i = await prisma.inscricaoWebinario.findFirst({ where: { webinarioId: a.id } });
    assert.equal(i.lembrete24hEm, null); assert.equal(i.lembrete1hEm, null);
    assert.deepEqual(enviados.filter((e) => e[0] === 'horario'), [['horario', aluno.email, true]]);
    // ao vivo no passado; gravação salva depois do fim → e-mail uma vez só
    await prisma.webinario.update({ where: { id: a.id }, data: { inicioEm: new Date('2020-01-01T22:00:00Z') } });
    const campos = { nome: a.curso.nome, duracaoMin: '60', gratuito: '1', inicioEm: '2020-01-01T19:00', gravacaoUrl: 'https://youtu.be/dQw4w9WgXcQ' };
    await enviar(`/ead/webinarios/${a.id}`, campos);
    await enviar(`/ead/webinarios/${a.id}`, campos);
    assert.equal(enviados.filter((e) => e[0] === 'gravacao').length, 1);
    assert.ok((await prisma.webinario.findUnique({ where: { id: a.id } })).gravacaoAvisadaEm);
  });

  test('menu do modo Online tem Conteúdos › Webinários depois de E-books', () => {
    const menu = require('../src/lib/menu-painel').montarMenu({ modo: 'online', papel: 'DEV', pode: () => true, ativo: '' });
    const g = menu.find((x) => x.id === 'conteudos');
    assert.deepEqual(g.itens.map((i) => i.href), ['/ead/ebooks', '/ead/webinarios']);
  });
});
