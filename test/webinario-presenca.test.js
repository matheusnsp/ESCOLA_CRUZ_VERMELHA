// Webinários (2026-11-13; spec §3 palavra-código): presença, limite de 10 tentativas por hora, bloco na página.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('palavra-código e presença', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const s = String(Date.now()).slice(-7);
  const INICIO = new Date('2031-05-10T22:00:00Z');
  let w; let ana; let bia; let caio; let server; let site; let restaurarEd; let agoraOrig;

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    agoraOrig = wb.agora;
    w = (await wb.salvar({ nome: `Palavra ${s}`, gratuito: '1', duracaoMin: '60', publicado: '1', palavraCodigo: 'Coração Valente', inicioEm: '2031-05-10T19:00' })).webinario;
    [ana, bia, caio] = await Promise.all(['ana', 'bia', 'caio'].map((n) => prisma.usuario.create({ data: { nome: n, email: `${n}-pc-${s}@teste.local`, papel: 'ALUNO' } })));
    for (const u of [ana, caio]) await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: u.id } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/webinarios'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close(); wb.agora = agoraOrig;
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id, caio.id] } } });
    await wb.excluir(w.id);
    if (restaurarEd) await restaurarEd();
    await prisma.$disconnect();
  });
  const url = (resto = '') => `${site}/escola-digital/webinario/${wb.endereco(w.curso.nome)}${resto}`;
  const pagina = async (u) => (await fetch(url(), { headers: { 'x-teste-usuario': u.id } })).text();

  test('antes do início: bloco ausente e POST recusado (cedo)', async () => {
    wb.agora = () => new Date(INICIO.getTime() - 10 * 60e3);
    assert.doesNotMatch(await pagina(ana), /palavra-código/i);
    assert.deepEqual(await wb.confirmarPresenca(ana.id, w, 'Coração Valente', wb.agora()), { ok: false, erro: 'cedo' });
  });

  test('errada, certa com maiúsculas/acentos/espaços nas pontas; segunda vez não duplica; espaços internos contam', async () => {
    const agora = new Date(INICIO.getTime() + 50 * 60e3);
    wb.agora = () => agora;
    assert.match(await pagina(ana), /Pegar certificado/);
    assert.deepEqual(await wb.confirmarPresenca(ana.id, w, 'coração  valente', agora), { ok: false, erro: 'nao-confere' });
    assert.deepEqual(await wb.confirmarPresenca(ana.id, w, '  CORACAO VALENTE ', agora), { ok: true, nova: true });
    assert.deepEqual(await wb.confirmarPresenca(ana.id, w, 'Coração Valente', agora), { ok: true, nova: false });
    assert.equal(await prisma.presencaWebinario.count({ where: { webinarioId: w.id, usuarioId: ana.id } }), 1);
    const h = await pagina(ana);
    assert.match(h, /Ver certificado/); assert.doesNotMatch(h, /Pegar certificado/);
  });

  test('sem acesso → sem-acesso; 11ª tentativa na hora bloqueia mesmo certa; uma hora depois passa', async () => {
    const agora = new Date(INICIO.getTime() + 50 * 60e3);
    assert.deepEqual(await wb.confirmarPresenca(bia.id, w, 'Coração Valente', agora), { ok: false, erro: 'sem-acesso' });
    for (let i = 0; i < 10; i++) assert.equal((await wb.confirmarPresenca(caio.id, w, 'errada', agora)).erro, 'nao-confere');
    assert.deepEqual(await wb.confirmarPresenca(caio.id, w, 'Coração Valente', agora), { ok: false, erro: 'tentativas' });
    await prisma.tentativaPalavraWebinario.updateMany({ where: { usuarioId: caio.id }, data: { criadoEm: new Date(Date.now() - 61 * 60e3) } });
    assert.deepEqual(await wb.confirmarPresenca(caio.id, w, 'Coração Valente', agora), { ok: true, nova: true });
  });

  test('rota: errada volta com a mensagem; certa volta com Ver certificado', async () => {
    const u = await prisma.usuario.create({ data: { nome: 'davi', email: `davi-pc-${s}@teste.local`, papel: 'ALUNO' } });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: u.id } });
    const post = (p) => fetch(url('/palavra-codigo'), { method: 'POST', redirect: 'manual', headers: { 'x-teste-usuario': u.id, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', palavra: p }) });
    let r = await post('nada');
    assert.match(r.headers.get('location'), /palavra=nao-confere/);
    r = await post('coração valente');
    assert.doesNotMatch(r.headers.get('location'), /palavra=/);
    assert.match(await pagina(u), /Ver certificado/);
    await prisma.usuario.delete({ where: { id: u.id } });
  });
});
