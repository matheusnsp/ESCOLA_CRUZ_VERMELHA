// "Minha escola" (gestor) e o convite do lote (etapa 6). App de teste com sessão por cabeçalho.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { urlOnline } = require('../src/lib/vitrine');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('Minha escola e convite', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const L = require('../src/lib/ead-lote');
  require('../src/lib/email').enviarVagaLiberada = async () => {};
  require('../src/lib/email').enviarGestorEscola = async () => {};
  const sufixo = Date.now();
  let server; let site; let curso; let co; let lote; let loteOutro; let gestor; let outroGestor; let aluno; let tela;
  const p = (n) => ({ nome: `Func ${n} Escola`, email: `f${n}-esc-${sufixo}@teste.local`, celular: '21988887777', cpf: cpf() });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE escola ${sufixo}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M' } });
    tela = (await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', telas: { create: [{ titulo: 'x' }] } }, include: { telas: true } })).telas[0];
    const g = { nome: 'Gestora Escola', email: `g-esc-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    lote = (await L.criarLote({ escola: { nome: `Escola Rotas ${sufixo}` }, cursoOnlineId: co.id, vagas: 2, validoAte: new Date(Date.now() + 30 * 864e5), valor: 300, forma: 'PIX', gestor: g, atorId: 'dev' })).lote;
    gestor = await prisma.usuario.findFirst({ where: { email: g.email } });
    const g2 = { nome: 'Outro Gestor', email: `g2-esc-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    loteOutro = (await L.criarLote({ escola: { nome: `Outra Escola ${sufixo}` }, cursoOnlineId: co.id, vagas: 1, validoAte: new Date(Date.now() + 30 * 864e5), valor: 0, forma: 'OUTRO', gestor: g2, atorId: 'dev' })).lote;
    outroGestor = await prisma.usuario.findFirst({ where: { email: g2.email } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Convite', email: `al-esc-${sufixo}@teste.local`, papel: 'ALUNO' } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/ead-escola'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    for (const l of [lote, loteOutro]) {
      await prisma.logAuditoria.deleteMany({ where: { alvoId: l.id } });
      await prisma.vagaLoteEad.deleteMany({ where: { loteId: l.id } });
      await prisma.loteEad.delete({ where: { id: l.id } });
      await prisma.escolaEad.delete({ where: { id: l.escolaId } });
    }
    await prisma.usuario.deleteMany({ where: { email: { contains: `-esc-${sufixo}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });
  const req = (url, u, opts = {}) => fetch(site + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(u ? { 'x-teste-usuario': u.id } : {}) } });
  const post = (url, u, corpo = {}) => req(url, u, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const loc = (r) => decodeURIComponent(r.headers.get('location') || '');

  test('não logado ⇒ login; logado sem ser gestor ⇒ 404; gestor vê só a própria escola', async () => {
    assert.match(loc(await req('/minha-escola', null)), /\/login$/);
    assert.equal((await req('/minha-escola', aluno)).status, 404);
    const html = await (await req('/minha-escola', gestor)).text();
    assert.match(html, new RegExp(`Escola Rotas ${sufixo}`)); assert.doesNotMatch(html, /Outra Escola/);
    assert.equal((await req(`/minha-escola/lote/${loteOutro.id}`, gestor)).status, 404);
    assert.equal((await req(`/minha-escola/lote/${lote.id}`, outroGestor)).status, 404);
  });

  test('cadastrar: cria a vaga; CPF aparece mascarado; esgotado avisa sem gravar', async () => {
    const f1 = p(1);
    const r = await post(`/minha-escola/lote/${lote.id}/funcionario`, gestor, f1);
    assert.equal(r.status, 302); assert.match(loc(r), /ok=/);
    const pag = await (await req(`/minha-escola/lote/${lote.id}`, gestor)).text();
    assert.match(pag, /Func 1 Escola/);
    assert.match(pag, new RegExp(`\\*\\*\\*\\.${f1.cpf.slice(3, 6)}\\.${f1.cpf.slice(6, 9)}-\\*\\*`));
    assert.doesNotMatch(pag, new RegExp(f1.cpf));
    await post(`/minha-escola/lote/${lote.id}/funcionario`, gestor, p(2));
    const cheio = await post(`/minha-escola/lote/${lote.id}/funcionario`, gestor, p(3));
    assert.match(loc(cheio), /erro=.*vagas/i);
    assert.equal(await prisma.vagaLoteEad.count({ where: { loteId: lote.id, removidaEm: null } }), 2);
    // outro gestor não cadastra neste lote
    assert.equal((await post(`/minha-escola/lote/${lote.id}/funcionario`, outroGestor, p(4))).status, 404);
  });

  test('tirar: sem progresso ⇒ ok; com progresso ⇒ aviso', async () => {
    const [v1, v2] = await prisma.vagaLoteEad.findMany({ where: { loteId: lote.id, removidaEm: null }, orderBy: { criadoEm: 'asc' } });
    const ac = await prisma.alunoCursoEad.create({ data: { usuarioId: v2.usuarioId, cursoOnlineId: co.id } });
    await prisma.telaVistaEad.create({ data: { alunoCursoId: ac.id, telaId: tela.id } });
    assert.match(loc(await post(`/minha-escola/lote/${lote.id}/remover/${v2.id}`, gestor)), /erro=.*começou/i);
    assert.match(loc(await post(`/minha-escola/lote/${lote.id}/remover/${v1.id}`, gestor)), /ok=/);
  });

  test('convite: trocar muda o código; visitante vê o convite e o login guarda a volta', async () => {
    const antes = (await prisma.loteEad.findUnique({ where: { id: lote.id } })).convite;
    await post(`/minha-escola/lote/${lote.id}/convite/trocar`, gestor);
    const codigo = (await prisma.loteEad.findUnique({ where: { id: lote.id } })).convite;
    assert.notEqual(codigo, antes);
    assert.equal((await req(`/escola/convite/${antes}`, null)).status, 404);
    const vis = await req(`/escola/convite/${codigo}`, null);
    assert.equal(vis.status, 200);
    assert.match(await vis.text(), new RegExp(`Entre ou crie sua conta para usar a vaga da escola Escola Rotas ${sufixo}`));
    assert.match(loc(await req(`/escola/convite/${codigo}/entrar`, null)), /\/login$/);
    assert.match(loc(await req(`/escola/convite/${codigo}/criar-conta`, null)), /\/cadastro$/);
  });

  test('convite: logado confirma e vai ao curso; desligado avisa sem gravar', async () => {
    const codigo = (await prisma.loteEad.findUnique({ where: { id: lote.id } })).convite;
    assert.match(await (await req(`/escola/convite/${codigo}`, aluno)).text(), new RegExp(`Usar uma vaga da escola Escola Rotas ${sufixo}`));
    const r = await post(`/escola/convite/${codigo}`, aluno);
    assert.equal(r.status, 302); assert.equal(loc(r), `${urlOnline(curso)}/continuar`);
    assert.equal((await prisma.vagaLoteEad.findFirst({ where: { usuarioId: aluno.id } })).origem, 'CONVITE');
    await post(`/minha-escola/lote/${lote.id}/convite/desligar`, gestor);
    const x = await prisma.usuario.create({ data: { nome: 'Tarde Demais', email: `td-esc-${sufixo}@teste.local`, papel: 'ALUNO' } });
    assert.equal((await post(`/escola/convite/${codigo}`, x)).status, 404);
    assert.equal(await prisma.vagaLoteEad.count({ where: { usuarioId: x.id } }), 0);
  });
});
