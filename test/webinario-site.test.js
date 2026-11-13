// Webinários (2026-11-13; spec §3): página por situação, inscrição grátis, entrar na transmissão. Postgres LOCAL.
// Relógio fixo: wb.agora é trocado no teste; sessão pelo cabeçalho x-teste-usuario (só neste app de teste).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('webinário: página e transmissão', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const email = require('../src/lib/email');
  const s = String(Date.now()).slice(-7);
  const LINK = `https://zoom.us/j/secreto${s}`;
  const INICIO = new Date('2031-03-10T22:00:00Z'); // 19h Brasília
  let server; let site; let w; let gravado; let ana; let bia; let restaurarEd; let agoraOrig; const avisos = [];
  const origEmail = email.enviarWebinarConfirmado;

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    email.enviarWebinarConfirmado = async (para, nome, d) => { avisos.push({ para, ...d }); };
    agoraOrig = wb.agora;
    w = (await wb.salvar({ nome: `Engasgo ao vivo ${s}`, descricao: 'Curto', gratuito: '1', duracaoMin: '60', publicado: '1', palavraCodigo: 'Cruz', inicioEm: '2031-03-10T19:00', linkAoVivo: LINK })).webinario;
    gravado = (await wb.salvar({ nome: `Só gravado ${s}`, gratuito: '1', duracaoMin: '30', publicado: '1', palavraCodigo: 'X', gravacaoUrl: 'https://youtu.be/dQw4w9WgXcQ' })).webinario;
    ana = await prisma.usuario.create({ data: { nome: 'Ana Ouvinte', email: `ana-w-${s}@teste.local`, papel: 'ALUNO' } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Ouvinte', email: `bia-w-${s}@teste.local`, papel: 'ALUNO' } });
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
    server.close();
    wb.agora = agoraOrig; email.enviarWebinarConfirmado = origEmail;
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    for (const x of [w, gravado]) await wb.excluir(x.id);
    if (restaurarEd) await restaurarEd();
    await prisma.$disconnect();
  });

  const url = (x, resto = '') => `${site}/escola-digital/webinario/${wb.endereco(x.curso.nome)}${resto}`;
  const req = (u, usuario, opts = {}) => fetch(u, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const html = async (u, usuario) => (await req(u, usuario)).text();
  const post = (u, usuario, corpo = {}) => req(u, usuario, { method: 'POST', body: new URLSearchParams({ _csrf: 'x', ...corpo }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const relogio = (d) => { wb.agora = () => new Date(d); };
  const semVagas = (h) => assert.doesNotMatch(h, /vaga|restam|ocupad/i);

  test('antes: visitante, inscrever (grátis), inscrito; o link nunca está no HTML', async () => {
    relogio(INICIO.getTime() - 48 * 3600e3);
    let h = await html(url(w));
    assert.match(h, /Criar conta e inscrever-se/); semVagas(h);
    assert.match(h, /10\/03\/2031 às 19h/);
    h = await html(url(w), ana);
    assert.match(h, />\s*Inscrever-se\s*</);
    const r = await post(url(w, '/inscrever'), ana);
    assert.equal(r.status, 302);
    assert.equal(avisos.length, 1); assert.equal(avisos[0].para, ana.email); assert.ok(avisos[0].ics); assert.doesNotMatch(JSON.stringify(avisos[0]), new RegExp(LINK));
    h = await html(url(w), ana);
    assert.match(h, /Você está inscrito/); assert.match(h, /Adicionar à agenda/);
    assert.ok(!h.includes(LINK)); semVagas(h);
    const ics = await (await req(url(w, '/agenda.ics'), ana)).text();
    assert.match(ics, /DTSTART:20310310T220000Z/); assert.ok(!ics.includes(LINK));
  });

  test('dentro da janela: botão de entrar (sem o link no HTML); a rota redireciona só com acesso e na janela', async () => {
    relogio(INICIO.getTime() - 10 * 60e3);
    const h = await html(url(w), ana);
    assert.match(h, /Entrar na transmissão/); assert.ok(!h.includes(LINK));
    let r = await req(url(w, '/entrar-na-transmissao'), ana);
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), LINK);
    r = await req(url(w, '/entrar-na-transmissao'), bia); // sem inscrição
    assert.equal(r.status, 302); assert.ok(r.headers.get('location').endsWith(wb.endereco(w.curso.nome)));
    relogio(INICIO.getTime() - 3 * 3600e3);
    r = await req(url(w, '/entrar-na-transmissao'), ana); // fora da janela
    assert.ok(r.headers.get('location').endsWith(wb.endereco(w.curso.nome)));
  });

  test('depois: sem gravação → aviso; encerrado sem acesso não inscreve; com gravação → iframe; só gravado', async () => {
    relogio(INICIO.getTime() + 5 * 3600e3);
    let h = await html(url(w), ana);
    assert.match(h, /A gravação ficará disponível aqui/);
    h = await html(url(w), bia);
    assert.match(h, /Este webinário já aconteceu/);
    await post(url(w, '/inscrever'), bia);
    assert.equal(await prisma.inscricaoWebinario.count({ where: { webinarioId: w.id, usuarioId: bia.id } }), 0);
    await prisma.webinario.update({ where: { id: w.id }, data: { gravacaoUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' } });
    h = await html(url(w), ana);
    assert.match(h, /<iframe[^>]+youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    h = await html(url(w), bia); // agora abre para inscrição
    assert.match(h, />\s*Inscrever-se\s*</); assert.doesNotMatch(h, /<iframe/);
    await post(url(gravado, '/inscrever'), ana);
    h = await html(url(gravado), ana);
    assert.match(h, /<iframe/); assert.match(h, /Gravado/);
  });

  test('despublicado: inscrito continua vendo; visitante e não inscrito recebem 404', async () => {
    await prisma.webinario.update({ where: { id: w.id }, data: { publicado: false } });
    assert.equal((await req(url(w), ana)).status, 200);
    assert.equal((await req(url(w))).status, 404);
    assert.equal((await req(url(w), bia)).status, 404);
    await prisma.webinario.update({ where: { id: w.id }, data: { publicado: true } });
  });
});
