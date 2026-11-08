// Escola Digital (2026-11), Task 2 (vistoria B3, B7): o cupom trazido pelo link continua depois do login e do
// cadastro DE VERDADE (POST /login e /cadastro, com regenerate da sessão); o limite de tentativas conta só código
// errado. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('cupom com login e cadastro de verdade', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { hashSenha } = require('../src/lib/password');
  const s = String(Date.now()).slice(-7);
  const slug = `curso-cupom-sessao-${s}`;
  let server; let site; let curso; let co; let aluno; const emails = [];
  const C10 = `METADE${s}`; const C100 = `GRATIS${s}`;

  // Navegador mínimo: guarda o cookie da sessão e troca quando o servidor manda outro (regenerate).
  const navegador = () => {
    let cookie = '';
    const ir = async (url, opts = {}) => {
      const r = await fetch(site + url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie } });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return r;
    };
    const post = (url, campos) => ir(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos).toString() });
    return { ir, post, texto: async (url) => (await ir(url)).text() };
  };

  let restaurarEd; // Escola Digital começa desligada (2026-11): liga para o teste e devolve no fim

  before(async () => { restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital(); });

  after(async () => { if (restaurarEd) await restaurarEd(); });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Cupom Sessao ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 100, publicado: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    await prisma.cupomEad.create({ data: { codigo: C10, tipo: 'PERCENTUAL', valor: 50, cursoOnlineId: co.id, criadoPor: 'teste' } });
    await prisma.cupomEad.create({ data: { codigo: C100, tipo: 'PERCENTUAL', valor: 100, cursoOnlineId: co.id, criadoPor: 'teste' } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluna Cupom', email: `al-cupom-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf(), senhaHash: await hashSenha('Senha!Forte#2026') } });
    emails.push(aluno.email);
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.documentoAluno = () => null;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { Object.assign(res.locals, { csrfToken: 'x', isAdmin: false }); next(); });
    app.use(require('../src/routes/auth'));
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const us = await prisma.usuario.findMany({ where: { email: { in: emails } }, select: { id: true } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ atorId: { in: us.map((u) => u.id) } }, { alvoId: { in: us.map((u) => u.id) } }] } }).catch(() => {});
    await prisma.usuario.deleteMany({ where: { id: { in: us.map((u) => u.id) } } });
    await prisma.cupomEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('cupom da capa continua depois do POST /login', async () => {
    const n = navegador();
    assert.match(await n.texto(`/online/${slug}?cupom=${C10}`), /aplicado/);
    const r = await n.post('/login', { identificador: aluno.email, senha: 'Senha!Forte#2026' });
    assert.equal(r.status, 302);
    const t = await n.texto(`/online/${slug}`);
    assert.match(t, new RegExp(`Cupom ${C10} aplicado`));
    assert.match(t, /R\$\s?50,00/);
  });

  test('cupom continua depois do POST /cadastro (conta nova)', async () => {
    const n = navegador();
    await n.texto(`/online/${slug}?cupom=${C10}`);
    const email = `novo-cupom-${s}@teste.local`; emails.push(email);
    const doc = cpf();
    const r = await n.post('/cadastro', { nome: 'Novo Aluno Cupom', email, tipoDocumento: 'CPF', documento: doc, celular: '21999990000', escolaridade: 'Ensino Médio', escolaridadeSituacao: 'Completo', consentimento: 'on' });
    assert.equal(r.status, 302, 'cadastro aceito');
    assert.match(await n.texto(`/online/${slug}`), new RegExp(`Cupom ${C10} aplicado`));
  });

  test('cupom de 100%: depois do cadastro a capa mostra "Liberar curso"', async () => {
    const n = navegador();
    await n.texto(`/online/${slug}?cupom=${C100}`);
    const email = `novo-gratis-${s}@teste.local`; emails.push(email);
    const r = await n.post('/cadastro', { nome: 'Nova Aluna Gratis', email, tipoDocumento: 'CPF', documento: cpf(), celular: '21999990001', escolaridade: 'Ensino Médio', escolaridadeSituacao: 'Completo', consentimento: 'on' });
    assert.equal(r.status, 302);
    assert.match(await n.texto(`/online/${slug}`), /Liberar curso/);
  });

  test('31 usos de um cupom válido não bloqueiam', async () => {
    const n = navegador();
    let t = '';
    for (let i = 0; i < 31; i++) t = await n.texto(`/online/${slug}?cupom=${C10}`);
    assert.match(t, /aplicado/);
    assert.doesNotMatch(t, /Muitas tentativas/);
  });

  test('30 códigos errados bloqueiam o 31º, mesmo válido', async () => {
    const n = navegador();
    for (let i = 0; i < 30; i++) await n.texto(`/online/${slug}?cupom=ERRADO${i}`);
    assert.match(await n.texto(`/online/${slug}?cupom=${C10}`), /Muitas tentativas/);
  });
});
