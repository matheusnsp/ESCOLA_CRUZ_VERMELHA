// Webinários (2026-11-13; spec §4): certificado de participação (selo WEBINÁRIO, texto, número, e-mail só na 1ª vez).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('certificado do webinário', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const email = require('../src/lib/email');
  const redacao = require('../src/lib/redacao');
  const s = String(Date.now()).slice(-7);
  let w; let gravado; let ana; let bia; let server; let site; let restaurarEd; let agoraOrig; const emails = [];
  const orig = { e: email.enviarCertificadoWebinarPronto, r: redacao.registrarCertificados };

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    agoraOrig = wb.agora; wb.agora = () => new Date('2031-06-10T23:30:00Z');
    email.enviarCertificadoWebinarPronto = async (para, nome, d) => { emails.push({ para, ...d }); };
    redacao.registrarCertificados = async () => ({ codigos: {}, falhas: 0 });
    w = (await wb.salvar({ nome: `Certificado webinário ${s}`, gratuito: '1', duracaoMin: '90', publicado: '1', palavraCodigo: 'cruz', inicioEm: '2031-06-10T19:00', apresentador: 'Enf. Ana Souza' })).webinario;
    gravado = (await wb.salvar({ nome: `Certificado gravado ${s}`, gratuito: '1', duracaoMin: '45', publicado: '1', palavraCodigo: 'cruz', gravacaoUrl: 'https://youtu.be/dQw4w9WgXcQ' })).webinario;
    [ana, bia] = await Promise.all(['ana', 'bia'].map((n) => prisma.usuario.create({ data: { nome: `${n} Certificada`, email: `${n}-wc-${s}@teste.local`, papel: 'ALUNO' } })));
    for (const x of [w, gravado]) await prisma.inscricaoWebinario.create({ data: { webinarioId: x.id, usuarioId: ana.id } });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: bia.id } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.documentoAluno = () => null;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/webinarios'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close(); wb.agora = agoraOrig;
    email.enviarCertificadoWebinarPronto = orig.e; redacao.registrarCertificados = orig.r;
    const pres = await prisma.presencaWebinario.findMany({ where: { usuarioId: { in: [ana.id, bia.id] } }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: pres.map((p) => p.id) } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    for (const x of [w, gravado]) await wb.excluir(x.id);
    if (restaurarEd) await restaurarEd();
    await prisma.$disconnect();
  });
  const url = (x, resto = '') => `${site}/escola-digital/webinario/${wb.endereco(x.curso.nome)}${resto}`;
  const get = (u, quem) => fetch(u, { redirect: 'manual', headers: { 'x-teste-usuario': quem.id } });
  const palavra = (x, quem) => fetch(url(x, '/palavra-codigo'), { method: 'POST', redirect: 'manual', headers: { 'x-teste-usuario': quem.id, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', palavra: 'Cruz' }) });

  test('sem presença → volta para a página', async () => {
    const r = await get(url(w, '/certificado'), bia);
    assert.equal(r.status, 302);
  });

  test('com presença: selo, texto, data do ao vivo, duração; mesmo número nas duas aberturas; e-mail só na 1ª', async () => {
    await palavra(w, ana);
    await palavra(w, ana);
    assert.equal(emails.length, 1); assert.equal(emails[0].para, ana.email); assert.match(emails[0].link, /\/certificado$/);
    const h = await (await get(url(w, '/certificado'), ana)).text();
    assert.match(h, /WEBINÁRIO/);
    assert.match(h, /participou do webinário/);
    assert.match(h, /realizado em <b>10\/06\/2031<\/b>/);
    assert.match(h, /02 horas/);
    assert.match(h, /Enf\. Ana Souza/);
    assert.doesNotMatch(h, /Capacitação teórica|CURSO ONLINE|Conteúdo Programático/);
    const reg = (t) => (t.match(/Registro:<\/b> Nº (\d+)/) || [])[1];
    const h2 = await (await get(url(w, '/certificado'), ana)).text();
    assert.ok(reg(h)); assert.equal(reg(h), reg(h2));
  });

  test('só gravado: "modalidade gravada", sem null/Invalid', async () => {
    await palavra(gravado, ana);
    const h = await (await get(url(gravado, '/certificado'), ana)).text();
    assert.match(h, /na modalidade gravada/);
    assert.doesNotMatch(h, /null|Invalid|undefined/);
  });

  test('estorno/perda de acesso depois da presença: certificado continua abrindo', async () => {
    await palavra(w, bia);
    await prisma.inscricaoWebinario.deleteMany({ where: { webinarioId: w.id, usuarioId: bia.id } });
    const r = await get(url(w, '/certificado'), bia);
    assert.equal(r.status, 200);
  });
});
