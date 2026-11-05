// Curso só online (etapa 5): criar/editar, fora do presencial, no catálogo só publicado. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const express = require('express');

test('admin.js passa as listas e a criação de turma pelo filtro do curso só online', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  // lista de cursos, formulário de turma nova (GET e erro do POST), edição de turma (GET e erro do POST)
  assert.ok((src.match(/semSoOnline\(/g) || []).length >= 5, 'semSoOnline nas listas do presencial');
  assert.ok((src.match(/ehSoOnline\(/g) || []).length >= 2, 'ehSoOnline ao criar e ao editar turma');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('curso só online', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cso = require('../src/lib/ead-curso-online');
  const cacheRapido = require('../src/lib/cache-rapido');
  const vitrine = require('../src/lib/vitrine');
  const sufixo = Date.now();
  const nome = `Curso Só Online Teste ${sufixo}`;
  let co; let presencial; let server; let site; let cursosRouter;

  before(async () => {
    presencial = await prisma.curso.create({ data: { nome: `Presencial Colisão ${sufixo}`, cargaHoraria: 4, precoAvista: 100, precoCheio: 100, valorParcela: 100, ativo: true } });
    cursosRouter = require('../src/routes/cursos');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.use((req, res, next) => { res.locals.urlSite = 'https://escola.exemplo'; res.locals.usuario = null; next(); });
    app.use(cursosRouter);
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const c = await prisma.curso.findFirst({ where: { nome: { startsWith: 'Curso Só Online Teste' } }, include: { online: true } });
    if (c) { if (c.online) await prisma.cursoOnline.delete({ where: { id: c.online.id } }); await prisma.curso.delete({ where: { id: c.id } }); }
    await prisma.curso.delete({ where: { id: presencial.id } });
    await prisma.$disconnect();
  });

  test('criar: Curso inativo e CursoOnline somenteOnline; validações', async () => {
    assert.deepEqual(await cso.criarCursoOnline({ nome: ' ', cargaHoraria: 3 }), { ok: false, erro: 'Dê um nome ao curso.' });
    assert.equal((await cso.criarCursoOnline({ nome, cargaHoraria: 0 })).ok, false);
    // [Review Focus] mesmo endereço de outro curso (caixa/acentos diferentes)
    const colide = await cso.criarCursoOnline({ nome: `presencial colisao ${sufixo}`, cargaHoraria: 3 });
    assert.equal(colide.ok, false); assert.match(colide.erro, /já existe um curso/i);
    const r = await cso.criarCursoOnline({ nome, descricao: 'Só online.', cargaHoraria: 3, imagemUrl: null });
    assert.equal(r.ok, true); co = r.co;
    const c = await prisma.curso.findUnique({ where: { id: co.cursoId }, include: { online: true } });
    assert.equal(c.ativo, false); assert.equal(c.online.somenteOnline, true); assert.equal(c.cargaHoraria, 3);
  });

  test('editar: muda os dados; nome repetido recusado; o próprio nome aceito', async () => {
    assert.equal((await cso.editarCursoOnline(co.id, { nome, descricao: 'Nova descrição.', cargaHoraria: 5 })).ok, true);
    const c = await prisma.curso.findUnique({ where: { id: co.cursoId } });
    assert.equal(c.descricao, 'Nova descrição.'); assert.equal(c.cargaHoraria, 5);
    assert.equal((await cso.editarCursoOnline(co.id, { nome: presencial.nome, cargaHoraria: 5 })).ok, false);
  });

  test('presencial: semSoOnline tira o curso; ehSoOnline o reconhece', async () => {
    const ids = await cso.idsSoOnline();
    assert.ok(ids.has(co.cursoId)); assert.ok(!ids.has(presencial.id));
    const lista = await cso.semSoOnline([{ id: co.cursoId }, { id: presencial.id }]);
    assert.deepEqual(lista.map((x) => x.id), [presencial.id]);
    assert.equal(await cso.ehSoOnline(co.cursoId), true); assert.equal(await cso.ehSoOnline(presencial.id), false);
  });

  test('[Review Focus] vitrine do DEV (filtro {}) não traz o curso só online', async () => {
    const lista = await cursosRouter.carregarVitrine({});
    assert.ok(!lista.some((c) => c.id === co.cursoId));
  });

  test('não publicado: fora do catálogo, endereço 404, fora do sitemap', async () => {
    cacheRapido.limparTudo();
    assert.deepEqual((await cso.cursosSoOnlinePublicados()).filter((c) => c.id === co.cursoId), []);
    assert.equal((await fetch(`${site}${vitrine.urlCurso({ nome })}`, { redirect: 'manual' })).status, 404);
    assert.doesNotMatch(await (await fetch(`${site}/sitemap.xml`)).text(), new RegExp(`/online/${co.cursoId}`));
  });

  test('publicado: no catálogo com link /online, endereço redireciona, sitemap traz /online', async () => {
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: true, precoOnline: 39.9 } });
    cacheRapido.limparTudo();
    const [c] = (await cso.cursosSoOnlinePublicados()).filter((x) => x.id === co.cursoId);
    assert.deepEqual(c.online, { preco: 39.9, somenteOnline: true });
    const html = await ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'partials', 'v-card-cat.ejs'), { curso: { ...c, turmas: [] }, vitrine, taxaExibicao: () => 0, cfgMap: {}, urlCurso: vitrine.urlCurso });
    assert.match(html, new RegExp(`href="/online/${co.cursoId}"`));
    assert.doesNotMatch(html, /Matrícula à vista/); assert.match(html, /R\$\s?39,90/);
    assert.match(html, /data-aberta="1"/); // [revisão M9] o filtro "inscrições abertas" não esconde o curso online
    const r = await fetch(`${site}${vitrine.urlCurso({ nome })}`, { redirect: 'manual' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/online/${co.cursoId}`);
    assert.match(await (await fetch(`${site}/sitemap.xml`)).text(), new RegExp(`https://escola.exemplo/online/${co.cursoId}`));
  });

  test('[revisão I4] página do curso presencial: a lista de cursos só online vem do cache, não do banco a cada visita', async () => {
    cacheRapido.limparTudo();
    const original = prisma.cursoOnline.findMany; let consultas = 0;
    prisma.cursoOnline.findMany = (...a) => { consultas++; return original.apply(prisma.cursoOnline, a); };
    try {
      const url = `${site}${vitrine.urlCurso(presencial)}`;
      await fetch(url, { redirect: 'manual' }); const primeira = consultas;
      await fetch(url, { redirect: 'manual' }); await fetch(url, { redirect: 'manual' });
      assert.equal(consultas, primeira, 'visitas seguintes não consultam cursoOnline');
    } finally { prisma.cursoOnline.findMany = original; }
  });

  test('desativar: apaga o CursoOnline e o Curso', async () => {
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: false } });
    assert.deepEqual(await cso.apagarCursoSoOnline(co.id), { ok: true });
    assert.equal(await prisma.curso.count({ where: { id: co.cursoId } }), 0);
  });
});

describe('curso só online pelo painel', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  let server; let painel; const auditoria = [];
  const nome = `Curso Painel Só Online ${Date.now()}`;
  before(async () => {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      req.session = { usuarioId: null };
      Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV' } });
      next();
    });
    app.use(require('../src/routes/ead')({ requireDev: (req, res, next) => next(), auditar: async (req, acao) => { auditoria.push(acao); }, ADMIN_URL: '' }));
    await new Promise((r) => { server = app.listen(0, r); });
    painel = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const c = await prisma.curso.findFirst({ where: { nome: { startsWith: 'Curso Painel Só Online' } }, include: { online: true } });
    if (c) { if (c.online) await prisma.cursoOnline.delete({ where: { id: c.online.id } }); await prisma.curso.delete({ where: { id: c.id } }); }
    await prisma.$disconnect();
  });
  const post = (url, corpo) => fetch(painel + url, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('criar, ver "Dados do curso", editar e desativar (apaga o Curso)', async () => {
    assert.match(await (await fetch(`${painel}/ead`)).text(), /Criar curso só online/);
    const ruim = await post('/ead/curso-online/novo', { nome: 'ab', cargaHoraria: '3' });
    assert.equal(ruim.status, 400);
    const r = await post('/ead/curso-online/novo', { nome, cargaHoraria: '3', descricao: 'Descrição inicial.' });
    assert.equal(r.status, 302);
    const co = await prisma.cursoOnline.findFirst({ where: { curso: { nome } } });
    assert.ok(co.somenteOnline); assert.match(r.headers.get('location'), new RegExp(`/ead/curso/${co.id}\\?ok=`));
    assert.ok(auditoria.includes('EAD_CRIOU_CURSO_ONLINE'));
    const pagina = await (await fetch(`${painel}/ead/curso/${co.id}`)).text();
    assert.match(pagina, /Dados do curso/); assert.match(pagina, /Descrição inicial\./);
    const ed = await post(`/ead/curso/${co.id}/dados`, { nome, cargaHoraria: '6', descricao: 'Descrição nova.' });
    assert.equal(ed.status, 302);
    assert.equal((await prisma.curso.findUnique({ where: { id: co.cursoId } })).cargaHoraria, 6);
    const d = await post(`/ead/curso/${co.id}/desativar`, {});
    assert.equal(d.status, 302);
    assert.equal(await prisma.curso.count({ where: { id: co.cursoId } }), 0);
  });
});
