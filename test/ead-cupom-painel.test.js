// Painel → Cupons (etapa 7, só DEV): criar, editar, desativar, apagar, compras e o cupom nos alunos do curso.
// Postgres LOCAL; o roteador do EAD com requireDev liberado (como em test/ead-lote-painel.test.js).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('Painel → Cupons', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  const cod = (x) => `P${s}-${x}`;
  let server; let site; let curso; let co; let turma; let aluno; let semDev; let semDevSite;

  const montar = (requireDev) => {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: 'dev-cupom' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: 'dev' } }); next(); });
    app.use(require('../src/routes/ead')({ requireDev, auditar: async () => {}, ADMIN_URL: '' }));
    return app;
  };

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Painel Cupom ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 50 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
    aluno = await prisma.usuario.create({ data: { nome: 'Tiago Cupom Painel', email: `tiago-cp-${s}@teste.local`, papel: 'ALUNO' } });
    await new Promise((r) => { server = montar((req, res, next) => next()).listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
    await new Promise((r) => { semDev = montar((req, res) => res.status(404).send('não')).listen(0, r); });
    semDevSite = `http://127.0.0.1:${semDev.address().port}`;
  });
  after(async () => {
    server.close(); semDev.close();
    const cs = await prisma.cupomEad.findMany({ where: { codigo: { startsWith: `P${s}-` } } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { cupomId: { in: cs.map((c) => c.id) } } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: cs.map((c) => c.id) } } });
    await prisma.cupomEad.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
    await prisma.matricula.deleteMany({ where: { alunoId: aluno.id } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.usuario.delete({ where: { id: aluno.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const get = async (url) => (await fetch(`${site}${url}`)).text();
  const post = (url, corpo) => fetch(`${site}${url}`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const cupomDe = (x) => prisma.cupomEad.findUnique({ where: { codigo: cod(x) } });

  test('criar: vai para a página do cupom e aparece na lista com 0 / 10 usos', async () => {
    const form = await get('/ead/cupons/novo');
    assert.match(form, /name="codigo"/);
    assert.match(form, /Todos os cursos online/);
    const r = await post('/ead/cupons/novo', { codigo: cod('lei10').toLowerCase(), tipo: 'PERCENTUAL', valor: '10', cursoOnlineId: co.id, validoAte: '2099-12-31', limiteUsos: '10', observacao: 'campanha' });
    assert.equal(r.status, 302);
    const c = await cupomDe('LEI10');
    assert.ok(c);
    assert.match(r.headers.get('location'), new RegExp(`^/ead/cupons/${c.id}\\?ok=`));
    assert.equal(c.validoAte.toISOString().slice(0, 10), '2099-12-31');
    assert.equal(Number(c.valor), 10);
    const lista = await get('/ead/cupons');
    assert.match(lista, new RegExp(cod('LEI10')));
    assert.match(lista, /0 \/ 10/);
    assert.match(lista, new RegExp(`Curso Painel Cupom ${s}`));
  });

  test('código repetido ⇒ a mensagem na tela, status 400', async () => {
    const r = await post('/ead/cupons/novo', { codigo: cod('LEI10'), tipo: 'VALOR', valor: '5' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Já existe um cupom com esse código\./);
  });

  test('editar: muda a validade e o limite; com valor em reais (vírgula)', async () => {
    const c = await cupomDe('LEI10');
    const r = await post(`/ead/cupons/${c.id}`, { codigo: c.codigo, tipo: 'PERCENTUAL', valor: '12,5', cursoOnlineId: '', validoAte: '', limiteUsos: '' });
    assert.equal(r.status, 302);
    const d = await cupomDe('LEI10');
    assert.equal(Number(d.valor), 12.5);
    assert.equal(d.cursoOnlineId, null);
    assert.equal(d.validoAte, null);
    assert.equal(d.limiteUsos, null);
  });

  test('desativar: some da lista de ativos; reativar volta', async () => {
    const c = await cupomDe('LEI10');
    await post(`/ead/cupons/${c.id}/ativar`, { ativo: '0' });
    assert.doesNotMatch(await get('/ead/cupons?ativos=1'), new RegExp(cod('LEI10')));
    assert.match(await get('/ead/cupons?ativos=0'), new RegExp(cod('LEI10')));
    await post(`/ead/cupons/${c.id}/ativar`, { ativo: '1' });
    assert.match(await get('/ead/cupons?ativos=1'), new RegExp(cod('LEI10')));
  });

  test('página do cupom lista a compra; alunos do curso mostram o código; apagar com compra ⇒ mensagem', async () => {
    const c = await cupomDe('LEI10');
    const m = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 43.75, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true, confirmadaEm: new Date() } });
    await prisma.cupomMatriculaEad.create({ data: { matriculaId: m.id, cupomId: c.id, precoCheio: 50, desconto: 6.25, precoFinal: 43.75 } });
    const pag = await get(`/ead/cupons/${c.id}`);
    assert.match(pag, /Tiago Cupom Painel/);
    assert.match(pag, /R\$\s?43,75/);
    assert.match(await get('/ead/cupons'), /1 \/ ∞|1 \/ sem limite/);
    assert.match(await get(`/ead/curso/${co.id}/alunos`), new RegExp(cod('LEI10')));
    const r = await post(`/ead/cupons/${c.id}/apagar`, {});
    assert.match(decodeURIComponent(r.headers.get('location')), /erro=Este cupom já foi usado e não pode ser apagado\./);
    assert.ok(await cupomDe('LEI10'));
  });

  test('apagar sem compra ⇒ some', async () => {
    await post('/ead/cupons/novo', { codigo: cod('TCHAU'), tipo: 'VALOR', valor: '5' });
    const c = await cupomDe('TCHAU');
    const r = await post(`/ead/cupons/${c.id}/apagar`, {});
    assert.equal(r.headers.get('location').split('?')[0], '/ead/cupons');
    assert.equal(await cupomDe('TCHAU'), null);
  });

  test('conta não DEV ⇒ 404', async () => {
    assert.equal((await fetch(`${semDevSite}/ead/cupons`)).status, 404);
  });
});
