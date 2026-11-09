// Escrever com IA (2026-11-09), Task 3: dúvidas frequentes na página de venda do curso só online e a lista no
// formulário do painel (adicionar/remover). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('curso online: dúvidas frequentes', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const vitrine = require('../src/lib/vitrine');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-faq-${s}`;
  let site; let srv; let painel; let restaurarEd; let c; let co;

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    c = await prisma.curso.create({ data: { nome: `Curso Faq Online ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: c.id, precoOnline: 30, publicado: true, somenteOnline: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', status: 'VALIDADO' } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo' }); next(); });
    app.use(require('../src/routes/ead-teste'));
    srv = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
    site = `http://127.0.0.1:${srv.address().port}`;
    painel = await ouvir(montarPainel(quem));
  });
  after(async () => {
    srv.close(); painel.server.close();
    if (restaurarEd) await restaurarEd();
    await prisma.faqCurso.deleteMany({ where: { cursoId: c.id } });
    await prisma.logAuditoria.deleteMany({ where: { atorId: quem } });
    await apagarCursosOnline(prisma, [co.id]);
  });

  const capa = async () => (await fetch(site + vitrine.urlOnline(c))).text();
  const post = (u, dados = {}) => fetch(painel.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', ...dados }) });

  test('sem dúvidas, a seção não aparece', async () => {
    assert.doesNotMatch(await capa(), /Dúvidas frequentes/);
  });

  test('adicionar pelo painel: a capa mostra em sanfona (texto escapado); remover tira', async () => {
    assert.equal((await post(`/ead/curso/${co.id}/faqs`, { pergunta: 'Tem certificado?', resposta: 'Sim, ao concluir.' })).status, 302);
    assert.equal((await post(`/ead/curso/${co.id}/faqs`, { pergunta: 'Pode <script>alert(1)</script>?', resposta: 'Não.' })).status, 302);
    const html = await capa();
    assert.match(html, /Dúvidas frequentes/);
    assert.match(html, /<details[^>]*>\s*<summary[^>]*>Tem certificado\?<\/summary>/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
    const form = await (await fetch(`${painel.url}/ead/curso/${co.id}/dados`)).text();
    assert.match(form, /Tem certificado\?/);
    const f = await prisma.faqCurso.findFirst({ where: { cursoId: c.id, pergunta: 'Tem certificado?' } });
    assert.equal((await post(`/ead/curso/${co.id}/faqs/${f.id}/remover`)).status, 302);
    assert.doesNotMatch(await capa(), /Tem certificado\?/);
    // (a auditoria do painel é injetada; montarPainel usa uma falsa — ADICIONOU_FAQ/REMOVEU_FAQ ficam no código)
  });
});
