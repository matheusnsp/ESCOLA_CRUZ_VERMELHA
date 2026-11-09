// Escola Digital — vitrine (fase 1, 2026-11-09), Task 4: a página /escola-digital estilo Netflix.
// Spec: docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md §1. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('vitrine /escola-digital', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const ed = require('../src/lib/escola-digital');
  const vitrine = require('../src/lib/vitrine');
  const cacheRapido = require('../src/lib/cache-rapido');
  const { turmaOnline } = require('../src/lib/turma-online');
  const s = String(Date.now()).slice(-7);
  let server; let site; let restaurarEd; let destaqueAntes; let outros;
  let cA; let cB; let cG; let coA; let coB; let coG; let aluno; let dev;

  const cab = (u, papel = 'ALUNO') => (u ? { 'x-teste-usuario': u, 'x-teste-papel': papel } : {});
  const pagina = async (quem, papel) => { cacheRapido.limparTudo(); ed.limparCache(); const r = await fetch(`${site}/escola-digital`, { headers: cab(quem, papel) }); return { status: r.status, html: await r.text() }; };
  const hero = (html) => (html.match(/<section class="ed-hero[\s\S]*?<\/section>/) || [''])[0];
  const linha = (html, titulo) => (html.match(new RegExp(`<section class="ed-sec"[^>]*>(?:(?!<section)[\\s\\S])*?${titulo}[\\s\\S]*?</section>`)) || [''])[0];

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    destaqueAntes = await prisma.configuracao.findUnique({ where: { chave: ed.CHAVE_DESTAQUE } });
    await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE_DESTAQUE } });
    // Outros cursos publicados do banco local ficam fora durante o teste (a ordem e o destaque são deste teste).
    outros = await prisma.cursoOnline.findMany({ where: { publicado: true }, select: { id: true } });
    await prisma.cursoOnline.updateMany({ where: { id: { in: outros.map((o) => o.id) } }, data: { publicado: false } });
    const curso = (nome, extra = {}) => prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 8, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false, descricao: `Descrição do ${nome}. `.repeat(20), ...extra } });
    cA = await curso('Vitrine Alfa'); cB = await curso('Vitrine Beta', { imagemUrl: '/img/capa.webp' }); cG = await curso('Vitrine Gratis');
    coA = await prisma.cursoOnline.create({ data: { cursoId: cA.id, precoOnline: 30, publicado: true, somenteOnline: true, ordemVitrine: 0, maxParcelas: 3 } });
    coB = await prisma.cursoOnline.create({ data: { cursoId: cB.id, precoOnline: 40, publicado: true, somenteOnline: true, ordemVitrine: 1 } });
    coG = await prisma.cursoOnline.create({ data: { cursoId: cG.id, precoOnline: 0, gratuito: true, publicado: true, somenteOnline: true, ordemVitrine: 2 } });
    for (const co of [coA, coB, coG]) {
      const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', status: 'VALIDADO' } });
      await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    }
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Vitrine', email: `alv-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    dev = await prisma.usuario.create({ data: { nome: 'Dev Vitrine', email: `devv-${s}@teste.local`, papel: 'DEV' } });
    const turma = await turmaOnline(coB);
    await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 40, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true, confirmadaEm: new Date() } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = vitrine.urlCurso;
    app.locals.requisitoCurso = vitrine.requisitoCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use(async (req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = req.get('x-teste-papel'); }
      Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo', escolaDigital: await ed.estaLigada() });
      next();
    });
    app.use(require('../src/routes/cursos'));
    app.use((r, res) => res.status(404).send('404'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    if (restaurarEd) await restaurarEd();
    await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE_DESTAQUE } });
    if (destaqueAntes) await prisma.configuracao.create({ data: { chave: destaqueAntes.chave, valor: destaqueAntes.valor } });
    await prisma.cursoOnline.updateMany({ where: { id: { in: outros.map((o) => o.id) } }, data: { publicado: true } });
    ed.limparCache(); cacheRapido.limparTudo();
    const ms = await prisma.matricula.findMany({ where: { alunoId: aluno.id }, select: { id: true } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    await prisma.turma.deleteMany({ where: { cursoId: { in: [cA.id, cB.id, cG.id] } } });
    await prisma.alunoCursoEad.deleteMany({ where: { usuarioId: aluno.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [aluno.id, dev.id] } } });
    const cos = [coA.id, coB.id, coG.id];
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: { in: cos } } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: { in: cos } } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: cos } } });
    await prisma.curso.deleteMany({ where: { id: { in: [cA.id, cB.id, cG.id] } } });
  });

  test('hero: automático = o primeiro da ordem; escolhido = o destaque; despublicado cai no automático', async () => {
    let { html } = await pagina();
    assert.match(hero(html), new RegExp(cA.nome));
    assert.match(hero(html), /Ver curso/);
    await prisma.configuracao.create({ data: { chave: ed.CHAVE_DESTAQUE, valor: coB.id } });
    ({ html } = await pagina());
    assert.match(hero(html), new RegExp(cB.nome));
    assert.match(hero(html), /url\(&#39;\/img\/capa\.webp&#39;\)|url\('\/img\/capa\.webp'\)/, 'foto do curso de fundo');
    await prisma.cursoOnline.update({ where: { id: coB.id }, data: { publicado: false } });
    try {
      ({ html } = await pagina());
      assert.match(hero(html), new RegExp(cA.nome));
    } finally {
      await prisma.cursoOnline.update({ where: { id: coB.id }, data: { publicado: true } });
      await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE_DESTAQUE } });
    }
  });

  test('linhas: Cursos online na ordem da vitrine; Gratuitos só com curso grátis; card grátis e parcelas', async () => {
    let { html } = await pagina();
    const cursos = linha(html, 'Cursos online');
    const pos = [cA, cB, cG].map((c) => cursos.indexOf(c.nome));
    assert.ok(pos.every((p) => p > 0), 'os 3 na linha');
    assert.ok(pos[0] < pos[1] && pos[1] < pos[2], 'ordem da vitrine');
    assert.match(cursos, /ou 3× no cartão/);
    const gr = linha(html, 'Gratuitos');
    assert.match(gr, new RegExp(cG.nome));
    assert.doesNotMatch(gr, new RegExp(cA.nome));
    assert.match(gr, /Grátis/);
    await prisma.cursoOnline.update({ where: { id: coG.id }, data: { publicado: false } });
    try {
      ({ html } = await pagina());
      assert.doesNotMatch(html, /Gratuitos/);
    } finally {
      await prisma.cursoOnline.update({ where: { id: coG.id }, data: { publicado: true } });
    }
  });

  test('aluno: "Continue de onde parou" com progresso, "Você já tem" e "Continuar"; visitante e DEV não', async () => {
    const { html } = await pagina(aluno.id);
    const cont = linha(html, 'Continue de onde parou');
    assert.match(cont, new RegExp(cB.nome));
    assert.match(cont, /width: ?\d+%/);
    assert.match(linha(html, 'Cursos online'), /Você já tem/);
    await prisma.configuracao.create({ data: { chave: ed.CHAVE_DESTAQUE, valor: coB.id } });
    try {
      assert.match(hero((await pagina(aluno.id)).html), /Continuar/);
    } finally {
      await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE_DESTAQUE } });
    }
    const vis = (await pagina()).html;
    assert.doesNotMatch(vis, /Continue de onde parou/);
    assert.doesNotMatch(vis, /Você já tem/);
    const d = await pagina(dev.id, 'DEV');
    assert.equal(d.status, 200);
    assert.doesNotMatch(d.html, /Continue de onde parou/);
  });

  test('sem vagas, sem JS inline, carrossel externo; desligada 404; sem cursos "em breve"', async () => {
    const { html } = await pagina(aluno.id);
    const corpo = html.replace(/<head>[\s\S]*?<\/head>/, '');
    assert.doesNotMatch(corpo.replace(/<[^>]+>/g, ' '), /vaga|restam|ocupad/i);
    assert.match(html, /<script[^>]+src="[^"]*escola-digital-vitrine[^"]*"/);
    // (o rastreamento do site, no <head>, já existia; a vitrine em si não põe script inline)
    const miolo = html.slice(html.indexOf('<main'), html.indexOf('<footer'));
    assert.doesNotMatch(miolo, /<script(?![^>]*\bsrc=)[^>]*>/, 'nenhum script inline na vitrine');
    await prisma.configuracao.update({ where: { chave: ed.CHAVE }, data: { valor: '0' } });
    try { assert.equal((await pagina()).status, 404); } finally { await prisma.configuracao.update({ where: { chave: ed.CHAVE }, data: { valor: '1' } }); }
    await prisma.cursoOnline.updateMany({ where: { id: { in: [coA.id, coB.id, coG.id] } }, data: { publicado: false } });
    try {
      const v = await pagina();
      assert.match(v.html, /Novos cursos online em breve\./);
      assert.match(v.html, /Aprenda onde estiver/);
    } finally {
      await prisma.cursoOnline.updateMany({ where: { id: { in: [coA.id, coB.id, coG.id] } }, data: { publicado: true } });
    }
  });
});
