// Dúvidas na tela do aluno (os dois modos) e aviso na capa. App de teste: sessão por cabeçalho.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('dúvidas na tela', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eadTeste = require('../src/lib/ead-teste');
  const duv = require('../src/lib/ead-duvidas');
  require('../src/lib/email').enviarDuvidaRespondida = async () => {};
  let server; let site; let base; let pago; let curso; let co; let tela; let tela2; let ana; let bia; let codigo;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE dúvidas rotas ${Date.now()}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 10, publicado: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1' } });
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'Tela um', ordem: 0 }, { titulo: 'Tela dois', ordem: 1 }] } }, include: { telas: { orderBy: { ordem: 'asc' } } } });
    [tela, tela2] = t.telas;
    ana = await prisma.usuario.create({ data: { nome: 'Ana Rotas Silva', email: `ana-dr-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Rotas', email: `bia-dr-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    codigo = await eadTeste.gerarCodigo(co.id);
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const u = req.get('x-teste-usuario');
      if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; }
      res.locals.csrfToken = 'x';
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
    base = `${site}/ead-teste/${codigo}`;
    pago = `${site}/online/${curso.id}`;
  });
  after(async () => {
    server.close();
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    await eadTeste.desligar(co.id);
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const req = (url, u, opts = {}) => fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(u ? { 'x-teste-usuario': u.id } : {}) } });
  const post = (url, u, corpo) => req(url, u, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const contar = () => prisma.duvidaEad.count({ where: { telaId: { in: [tela.id, tela2.id] } } });

  test('visitante: vê o bloco e o convite para entrar; o POST não grava e vai ao login', async () => {
    const html = await (await req(`${base}/tela/${tela.id}`, null)).text();
    assert.match(html, /Dúvidas desta aula/); assert.match(html, /Entre para mandar uma dúvida/);
    const r = await post(`${base}/tela/${tela.id}/duvida`, null, { texto: 'Pergunta de visitante sem login.' });
    assert.equal(r.status, 302); assert.match(r.headers.get('location'), /\/login$/);
    assert.equal(await contar(), 0);
  });

  test('aluna manda dúvida: volta com "enviada" e vê "aguardando resposta"; a outra não vê', async () => {
    const r = await post(`${base}/tela/${tela.id}/duvida`, ana, { texto: 'Quanto tempo devo checar a respiração?' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `/ead-teste/${codigo}/tela/${tela.id}?duvida=enviada#duvidas`);
    const minha = await (await req(`${base}/tela/${tela.id}?duvida=enviada`, ana)).text();
    assert.match(minha, /Quanto tempo devo checar a respiração\?/); assert.match(minha, /aguardando resposta/); assert.match(minha, /Dúvida enviada/);
    assert.doesNotMatch(await (await req(`${base}/tela/${tela.id}`, bia)).text(), /Quanto tempo devo checar/);
    const curta = await post(`${base}/tela/${tela.id}/duvida`, ana, { texto: 'curta' });
    assert.match(curta.headers.get('location'), /duvida=curta#duvidas$/);
  });

  test('[revisão I3] capa paga de curso publicado é indexável; o resto do EAD não', async () => {
    const capa = await req(pago, null);
    assert.equal(capa.status, 200);
    assert.equal(capa.headers.get('x-robots-tag'), null);
    assert.doesNotMatch(await capa.text(), /name="robots" content="noindex/);
    assert.equal((await req(base, null)).headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match((await req(`${pago}/criar-conta`, null)).headers.get('x-robots-tag') || '', /noindex/);
  });

  test('modo pago sem acesso: o POST volta à capa sem gravar', async () => {
    const antes = await contar();
    const r = await post(`${pago}/tela/${tela.id}/duvida`, bia, { texto: 'Pergunta de quem não comprou o curso.' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/online/${curso.id}`);
    assert.equal(await contar(), antes);
  });

  test('[Review Focus] HTML na dúvida e na resposta aparece como texto, com as quebras de linha', async () => {
    const acBia = await prisma.alunoCursoEad.upsert({ where: { usuarioId_cursoOnlineId: { usuarioId: bia.id, cursoOnlineId: co.id } }, update: {}, create: { usuarioId: bia.id, cursoOnlineId: co.id } });
    const e = await duv.enviarDuvida({ alunoCursoId: acBia.id, telaId: tela2.id, texto: '<script>alert(1)</script>\nlinha 2 da dúvida' });
    await duv.responder(e.duvida.id, '<b>oi</b>\nsegunda linha', 'dev', { linkBase: '/x' });
    const html = await (await req(`${base}/tela/${tela2.id}`, ana)).text();
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>alert\(1\)/);
    assert.match(html, /&lt;b&gt;oi&lt;\/b&gt;/);
    assert.match(html, /linha 2 da dúvida/); assert.match(html, /segunda linha/);
    assert.match(html, /Bia R\./);
  });

  test('capa: "Sua dúvida foi respondida" com link para a tela; abrir a tela apaga o aviso', async () => {
    const d = await prisma.duvidaEad.findFirst({ where: { telaId: tela.id } });
    await duv.responder(d.id, 'Até 10 segundos.', 'dev', { linkBase: '/x' });
    const capa = await (await req(base, ana)).text();
    assert.match(capa, /Sua dúvida foi respondida/);
    assert.match(capa, new RegExp(`/ead-teste/${codigo}/tela/${tela.id}#duvidas`));
    await req(`${base}/tela/${tela.id}`, ana);
    assert.doesNotMatch(await (await req(base, ana)).text(), /Sua dúvida foi respondida/);
  });
});
