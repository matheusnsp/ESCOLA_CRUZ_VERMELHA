// Revisão final da Escola Digital (I-1): o limite de tentativas de cupom vale também para quem posta direto em
// /comprar sem seguir o redirecionamento para a capa (era assim que o limite podia ser contornado). Processo
// próprio (o contador é em memória). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('limite de cupom na compra direta', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  let server; let site; let curso; let co; let aluno; let restaurarEd;
  const C100 = `TODO${s}`;

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    curso = await prisma.curso.create({ data: { nome: `Curso Limite Compra ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 100, publicado: true, somenteOnline: true } });
    await prisma.cupomEad.create({ data: { codigo: C100, tipo: 'PERCENTUAL', valor: 100, cursoOnlineId: co.id, criadoPor: 'teste' } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Limite', email: `lim-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { req.session.usuarioId = aluno.id; req.session.papel = 'ALUNO'; Object.assign(res.locals, { csrfToken: 'x', isAdmin: false }); next(); });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    if (restaurarEd) await restaurarEd();
    const ms = await prisma.matricula.findMany({ where: { alunoId: aluno.id }, select: { id: true } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { alunoId: aluno.id } });
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.alunoCursoEad.deleteMany({ where: { usuarioId: aluno.id } });
    await prisma.usuario.delete({ where: { id: aluno.id } });
    await prisma.cupomEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const comprar = (cupom) => fetch(`${site}/escola-digital/${curso.id}/comprar`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ forma: 'CUPOM', cupom }).toString() });

  test('30 códigos errados postados direto bloqueiam o cupom certo', async () => {
    for (let i = 0; i < 30; i++) assert.equal((await comprar(`ERRO${i}`)).status, 302);
    const r = await comprar(C100);
    assert.doesNotMatch(r.headers.get('location'), /continuar/, 'não pode liberar o curso');
    assert.equal(await prisma.matricula.count({ where: { alunoId: aluno.id, statusPagamento: 'PAGO' } }), 0);
  });
});
