// Central de dúvidas do painel (só DEV), contra o Postgres LOCAL. requireDev de mentira, e-mail espião.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('central de dúvidas', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const duv = require('../src/lib/ead-duvidas');
  const rel = require('../src/lib/ead-relatorios');
  const enviados = [];
  require('../src/lib/email').enviarDuvidaRespondida = async (para) => { enviados.push(para); };
  let server; let painel; let curso; let co; let curso2; let co2; let tela; let tela2; let telaB; let ana; let ac; let ac2; const ids = {};

  before(async () => {
    const montar = async (nome) => {
      const c = await prisma.curso.create({ data: { nome, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
      const o = await prisma.cursoOnline.create({ data: { cursoId: c.id } });
      const m = await prisma.moduloEad.create({ data: { cursoOnlineId: o.id, titulo: 'Módulo Central' } });
      const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'Tópico', telas: { create: [{ titulo: 'Tela A', ordem: 0 }, { titulo: 'Tela B', ordem: 1 }] } }, include: { telas: { orderBy: { ordem: 'asc' } } } });
      return { c, o, t: t.telas };
    };
    const a = await montar(`TESTE central ${Date.now()}`); curso = a.c; co = a.o; [tela, tela2] = a.t;
    const b = await montar(`TESTE central outro ${Date.now()}`); curso2 = b.c; co2 = b.o; [telaB] = b.t;
    ana = await prisma.usuario.create({ data: { nome: 'Ana Central', email: `ana-ce-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    ac = await prisma.alunoCursoEad.create({ data: { usuarioId: ana.id, cursoOnlineId: co.id } });
    ac2 = await prisma.alunoCursoEad.create({ data: { usuarioId: ana.id, cursoOnlineId: co2.id } });
    ids.velha = (await duv.enviarDuvida({ alunoCursoId: ac.id, telaId: tela.id, texto: 'Primeira dúvida, a mais antiga.' })).duvida.id;
    ids.nova = (await duv.enviarDuvida({ alunoCursoId: ac.id, telaId: tela.id, texto: 'Segunda dúvida, mais nova.' })).duvida.id;
    ids.tela2 = (await duv.enviarDuvida({ alunoCursoId: ac.id, telaId: tela2.id, texto: 'Dúvida na tela B do curso.' })).duvida.id;
    ids.outro = (await duv.enviarDuvida({ alunoCursoId: ac2.id, telaId: telaB.id, texto: 'Dúvida no outro curso online.' })).duvida.id;
    await prisma.duvidaEad.update({ where: { id: ids.velha }, data: { criadoEm: new Date(Date.now() - 3600e3) } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      req.session = { usuarioId: null };
      Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev Teste', papel: 'DEV' } });
      next();
    });
    app.use(require('../src/routes/ead')({ requireDev: (req, res, next) => next(), auditar: async () => {}, ADMIN_URL: '' }));
    await new Promise((r) => { server = app.listen(0, r); });
    painel = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: Object.values(ids) } } });
    await prisma.usuario.delete({ where: { id: ana.id } });
    for (const o of [co, co2]) await prisma.cursoOnline.delete({ where: { id: o.id } });
    for (const c of [curso, curso2]) await prisma.curso.delete({ where: { id: c.id } });
    await prisma.$disconnect();
  });

  const get = async (url) => (await fetch(painel + url)).text();
  const post = (url, corpo = {}) => fetch(painel + url, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('Aguardando por padrão, mais antiga primeiro, filtro por curso, badge no menu', async () => {
    const html = await get(`/ead/duvidas?curso=${co.id}`);
    const i1 = html.indexOf('Primeira dúvida, a mais antiga.'); const i2 = html.indexOf('Segunda dúvida, mais nova.');
    assert.ok(i1 > 0 && i2 > i1, 'a mais antiga primeiro');
    assert.doesNotMatch(html, /Dúvida no outro curso online/);
    assert.match(await get('/ead/duvidas'), /Dúvida no outro curso online/);
    const total = await duv.contarAguardando();
    assert.match(await get('/ead'), new RegExp(`class="adm-badge"[^>]*>${total}<`));
  });

  test('responder: sai de Aguardando, aparece em Respondidas, 1 e-mail', async () => {
    enviados.length = 0;
    const r = await post(`/ead/duvidas/${ids.velha}/responder`, { resposta: 'Resposta da Escola.', volta: `/ead/duvidas?curso=${co.id}` });
    assert.equal(r.status, 302); assert.match(decodeURIComponent(r.headers.get('location')), /ok=Resposta publicada/);
    assert.equal(enviados.length, 1);
    assert.doesNotMatch(await get(`/ead/duvidas?curso=${co.id}`), /Primeira dúvida, a mais antiga\./);
    assert.match(await get(`/ead/duvidas?status=RESPONDIDA&curso=${co.id}`), /Resposta da Escola\./);
    const dup = await post(`/ead/duvidas/${ids.velha}/responder`, { resposta: 'De novo.' });
    assert.match(decodeURIComponent(dup.headers.get('location')), /erro=/);
    assert.equal(enviados.length, 1);
  });

  test('descartar com motivo, editar, ocultar e reabrir', async () => {
    await post(`/ead/duvidas/${ids.nova}/descartar`, { motivo: 'repetida' });
    let d = await prisma.duvidaEad.findUnique({ where: { id: ids.nova } });
    assert.equal(d.status, 'DESCARTADA'); assert.equal(d.motivoDescarte, 'repetida');
    assert.match(await get('/ead/duvidas?status=DESCARTADA'), /repetida/);
    await post(`/ead/duvidas/${ids.velha}/editar`, { resposta: 'Resposta corrigida.' });
    assert.equal((await prisma.duvidaEad.findUnique({ where: { id: ids.velha } })).resposta, 'Resposta corrigida.');
    await post(`/ead/duvidas/${ids.velha}/ocultar`);
    assert.equal((await prisma.duvidaEad.findUnique({ where: { id: ids.velha } })).status, 'OCULTA');
    await post(`/ead/duvidas/${ids.nova}/reabrir`);
    d = await prisma.duvidaEad.findUnique({ where: { id: ids.nova } });
    assert.equal(d.status, 'AGUARDANDO');
    assert.equal((await post('/ead/duvidas/nao-existe/responder', { resposta: 'x' })).status, 302);
  });

  test('desempenho: telas com mais dúvidas', async () => {
    const { duvidasPorTela } = await rel.desempenhoDoCurso(co.id);
    assert.deepEqual(duvidasPorTela.map((x) => [x.titulo, x.total]), [['Tela A', 2], ['Tela B', 1]]);
    assert.equal(duvidasPorTela[0].modulo, 'Módulo Central');
    assert.match(await get(`/ead/curso/${co.id}/desempenho`), /Telas com mais dúvidas/);
  });
});
