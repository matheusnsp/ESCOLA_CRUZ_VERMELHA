// Dev e secretaria fazem o curso inteiro pelo link de teste (2026-11-09): logados no site, contam como aluno só no
// modo teste (inclusive os cenários do módulo final), com todos os módulos abertos, e ficam fora dos relatórios.
// Na página paga continuam como visitante. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('/ead-teste: equipe (Dev/secretaria)', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eadTeste = require('../src/lib/ead-teste');
  const rel = require('../src/lib/ead-relatorios');
  const s = String(Date.now()).slice(-7);
  let server; let base; let curso; let co; let codigo; let m1; let fin; let cen; let dev; let sec;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE equipe ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    await prisma.topicoEad.create({ data: { moduloId: m1.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    fin = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Juntando tudo', ordem: 1, final: true } });
    cen = await prisma.cenarioEad.create({ data: { moduloId: fin.id, titulo: 'Cena 1', decisoes: { create: [{ pergunta: 'D', opcoes: { create: [0, 1].map((k) => ({ ordem: k, texto: `O${k}`, correta: k === 1, feedback: `f${k}` })) } }] } } });
    codigo = await eadTeste.gerarCodigo(co.id);
    dev = await prisma.usuario.create({ data: { nome: 'Dev Equipe', email: `dev-eq-${s}@teste.local`, papel: 'DEV' } });
    sec = await prisma.usuario.create({ data: { nome: 'Sec Equipe', email: `sec-eq-${s}@teste.local`, papel: 'SECRETARIA' } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const u = req.get('x-teste-usuario');
      if (u) { req.session.usuarioId = u; req.session.papel = req.get('x-teste-papel'); }
      res.locals.csrfToken = 'x';
      next();
    });
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/ead-teste/${codigo}`;
  });
  after(async () => {
    server.close();
    const acs = await prisma.alunoCursoEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: acs.map((x) => x.id) } } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [dev.id, sec.id] } } });
    await eadTeste.desligar(co.id);
    await prisma.cenarioEad.deleteMany({ where: { moduloId: fin.id } });
    await prisma.topicoEad.deleteMany({ where: { moduloId: m1.id } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  const abrir = (url, u) => fetch(url, { redirect: 'manual', headers: u ? { 'x-teste-usuario': u.id, 'x-teste-papel': u.papel } : {} });

  test('Dev logado: módulo final mostra "Começar os cenários" (não "Criar conta") e o cenário abre, mesmo sem fazer o módulo 1', async () => {
    const html = await (await abrir(`${base}/modulo/${fin.id}`, dev)).text();
    assert.doesNotMatch(html, /Criar conta para fazer/);
    assert.match(html, /Começar os cenários/);
    const r = await abrir(`${base}/cenario/${cen.id}`, dev);
    assert.equal(r.status, 200);
  });

  test('secretaria também faz pelo link de teste; visitante continua vendo "Criar conta para fazer"', async () => {
    assert.match(await (await abrir(`${base}/modulo/${fin.id}`, sec)).text(), /Começar os cenários/);
    assert.match(await (await abrir(`${base}/modulo/${fin.id}`)).text(), /Criar conta para fazer/);
  });

  test('o progresso da equipe não entra nos relatórios do curso', async () => {
    assert.ok(await prisma.alunoCursoEad.count({ where: { cursoOnlineId: co.id, usuarioId: dev.id } }), 'Dev tem progresso (fez pelo link de teste)');
    const alunos = await rel.alunosDoCurso(co.id);
    assert.equal(alunos.filter((a) => /Equipe/.test(a.usuario.nome)).length, 0, 'fora da lista de alunos');
    await prisma.alunoCursoEad.updateMany({ where: { cursoOnlineId: co.id }, data: { concluidoEm: new Date() } });
    assert.equal((await rel.concluintesDoCurso(co.id)).length, 0, 'fora dos concluintes');
  });
});
