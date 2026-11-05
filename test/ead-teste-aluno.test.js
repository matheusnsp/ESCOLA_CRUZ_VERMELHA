// Rotas do aluno no link de teste (quiz, pré-teste, cenário) com sessão de aluno, contra o Postgres LOCAL.
// O app de teste põe o usuário na sessão pelo cabeçalho x-teste-usuario (só aqui, nunca no app real).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const eadTeste = temBanco ? require('../src/lib/ead-teste') : null;

describe('/ead-teste: aluno', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  let server; let base; let curso; let co; let codigo; let m1; let t1; let m2; let t2; let fin; let cen; let ana; let bia;
  const alt = () => ({ create: [{ texto: 'certa', correta: true, ordem: 0 }, { texto: 'errada', correta: false, ordem: 1 }] });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE rotas aluno', cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    t1 = await prisma.topicoEad.create({ data: { moduloId: m1.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M2', ordem: 1 } });
    t2 = await prisma.topicoEad.create({ data: { moduloId: m2.id, titulo: 'T2', telas: { create: [{ titulo: 'tela 2' }] } } });
    for (const t of [t1, t2]) for (let i = 0; i < 8; i++) await prisma.perguntaEad.create({ data: { topicoId: t.id, enunciado: `P${i}`, feedback: 'porque sim', alternativas: alt() } });
    fin = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'F', ordem: 2, final: true } });
    cen = await prisma.cenarioEad.create({ data: { moduloId: fin.id, titulo: 'C', decisoes: { create: [{ pergunta: 'D', opcoes: { create: [0, 1, 2].map((k) => ({ ordem: k, texto: `O${k}`, correta: k === 2, feedback: `fala ${k}` })) } }] } } });
    codigo = await eadTeste.gerarCodigo(co.id);
    ana = await prisma.usuario.create({ data: { nome: 'Ana Rota', email: `ana-rota-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Rota', email: `bia-rota-${Date.now()}@teste.local`, papel: 'ALUNO' } });

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
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/ead-teste/${codigo}`;
  });
  after(async () => {
    server.close();
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    await eadTeste.desligar(co.id);
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const req = (url, usuario, opts = {}) => fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (url, usuario, corpo = {}) => req(url, usuario, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('quiz sem login: vai para o login (nada é criado)', async () => {
    const r = await post(`${base}/topico/${t1.id}/quiz`, null);
    assert.equal(r.status, 302);
    assert.equal(await prisma.tentativaEad.count({ where: { topicoId: t1.id } }), 0);
  });

  test('quiz de módulo bloqueado: volta ao módulo e não cria tentativa', async () => {
    const r = await post(`${base}/topico/${t2.id}/quiz`, ana);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), new RegExp(`/modulo/${m2.id}$`));
    assert.equal(await prisma.tentativaEad.count({ where: { topicoId: t2.id } }), 0);
  });

  test('tentativa de outra aluna: 404; resposta repetida conta 1 vez', async () => {
    const r = await post(`${base}/topico/${t1.id}/quiz`, ana);
    assert.equal(r.status, 302);
    const url = r.headers.get('location');
    assert.match(url, /\/tentativa\/[0-9a-f-]{36}$/);
    const tid = url.split('/').pop();
    assert.equal((await req(`${base}/tentativa/${tid}`, bia)).status, 404);
    const pag = await (await req(`${base}/tentativa/${tid}`, ana)).text();
    assert.match(pag, /Pergunta 1 de 3/);
    assert.doesNotMatch(pag, /data-correta|correta=|"correta"/); // nada no HTML indica a certa
    const t = await prisma.tentativaEad.findUnique({ where: { id: tid } });
    const certa = await prisma.alternativaEad.findFirst({ where: { perguntaId: t.perguntaIds[0], correta: true } });
    const corpo = { perguntaId: t.perguntaIds[0], alternativa: certa.id };
    const a = await post(`${base}/tentativa/${tid}/responder`, ana, corpo);
    const b = await post(`${base}/tentativa/${tid}/responder`, ana, corpo);
    assert.equal(a.status, 200); // QUIZ: página de retorno
    assert.match(await a.text(), /Correto\./);
    assert.equal(b.status, 302); // repetida: ignorada, volta para a pergunta atual
    const depois = await prisma.tentativaEad.findUnique({ where: { id: tid } });
    assert.equal(depois.acertos, 1); assert.equal(depois.respostas.length, 1);
    assert.equal((await post(`${base}/tentativa/${tid}/responder`, bia, corpo)).status, 404);
  });

  test('pré-teste: uma tentativa só; a segunda volta ao módulo', async () => {
    const r1 = await post(`${base}/modulo/${m1.id}/pre-teste`, bia);
    assert.match(r1.headers.get('location'), /\/tentativa\//);
    const r2 = await post(`${base}/modulo/${m1.id}/pre-teste`, bia);
    assert.match(r2.headers.get('location'), new RegExp(`/modulo/${m1.id}$`));
    assert.equal(await prisma.tentativaEad.count({ where: { moduloId: m1.id, tipo: 'PRE_TESTE' } }), 1);
  });

});
