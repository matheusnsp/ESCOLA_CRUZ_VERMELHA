// Acesso ao curso pela vaga do lote (etapa 6) e volta ao curso depois do cadastro. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const { voltaDepoisDoCadastro } = require('../src/lib/conta-aluno');

test('voltaDepoisDoCadastro: link de teste, curso pago e convite; o resto não', () => {
  assert.equal(voltaDepoisDoCadastro('/ead-teste/AbC_123-x/continuar'), '/ead-teste/AbC_123-x/continuar');
  assert.equal(voltaDepoisDoCadastro('/online/primeiros-socorros/continuar'), '/online/primeiros-socorros/continuar');
  assert.equal(voltaDepoisDoCadastro('/escola/convite/AbCdEf_123-xyz'), '/escola/convite/AbCdEf_123-xyz');
  for (const ruim of ['/admin', '//evil.com', 'https://evil.com', '/online/x/tela/y', null, 42]) assert.equal(voltaDepoisDoCadastro(ruim), null);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('acesso pela vaga', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const L = require('../src/lib/ead-lote');
  const rel = require('../src/lib/ead-relatorios');
  require('../src/lib/email').enviarVagaLiberada = async () => {};
  require('../src/lib/email').enviarGestorEscola = async () => {};
  const sufixo = Date.now();
  let server; let base; let curso; let co; let lote; let ana; let bia; let tela;

  let restaurarEd; // Escola Digital começa desligada (2026-11): liga para o teste e devolve no fim

  before(async () => { restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital(); });

  after(async () => { if (restaurarEd) await restaurarEd(); });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE acesso lote ${sufixo}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 10, publicado: false } });
    for (const [i, t] of ['M1', 'M2'].entries()) {
      const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: t, ordem: i } });
      const tp = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', telas: { create: [{ titulo: `tela ${t}` }] } }, include: { telas: true } });
      if (!tela) tela = tp.telas[0];
    }
    const g = { nome: 'Gestora Acesso', email: `g-acesso-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    const r = await L.criarLote({ escola: { nome: `Escola Acesso ${sufixo}` }, cursoOnlineId: co.id, vagas: 5, validoAte: new Date(Date.now() + 30 * 864e5), valor: 100, forma: 'PIX', gestor: g, atorId: 'dev' });
    lote = r.lote;
    ana = (await L.cadastrarFuncionario(lote.id, { nome: 'Ana Acesso', email: `ana-acesso-${sufixo}@teste.local`, celular: '', cpf: cpf() }, { atorId: 'g' })).usuario;
    bia = (await L.cadastrarFuncionario(lote.id, { nome: 'Bia Acesso', email: `bia-acesso-${sufixo}@teste.local`, celular: '', cpf: cpf() }, { atorId: 'g' })).usuario;

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r2) => { server = app.listen(0, r2); });
    base = `http://127.0.0.1:${server.address().port}/online/${curso.id}`;
  });
  after(async () => {
    server.close();
    await prisma.logAuditoria.deleteMany({ where: { alvoId: lote.id } });
    await prisma.vagaLoteEad.deleteMany({ where: { loteId: lote.id } });
    await prisma.loteEad.delete({ where: { id: lote.id } });
    await prisma.escolaEad.delete({ where: { id: lote.escolaId } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-acesso-${sufixo}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });
  const req = (url, u) => fetch(url, { redirect: 'manual', headers: u ? { 'x-teste-usuario': u.id } : {} });

  test('com vaga: entra no curso mesmo fora do site; sem vaga: 404', async () => {
    const r = await req(`${base}/continuar`, ana);
    assert.equal(r.status, 302); assert.match(r.headers.get('location'), new RegExp(`/escola-digital/${curso.id}/tela/`));
    const outro = await prisma.usuario.create({ data: { nome: 'Sem Vaga', email: `sem-acesso-${sufixo}@teste.local`, papel: 'ALUNO' } });
    assert.equal((await req(base, outro)).status, 404);
  });

  test('vaga removida antes de começar: perde o acesso', async () => {
    const v = await prisma.vagaLoteEad.findFirst({ where: { usuarioId: bia.id } });
    assert.deepEqual(await L.removerVaga(v.id, 'g'), { ok: true });
    assert.equal((await req(base, bia)).status, 404);
  });

  test('7 dias contam da vaga: vaga de 8 dias atrás ⇒ ordem livre', async () => {
    await prisma.vagaLoteEad.updateMany({ where: { usuarioId: ana.id }, data: { criadoEm: new Date(Date.now() - 8 * 864e5) } });
    assert.match(await (await req(base, ana)).text(), /na ordem que você quiser/);
  });

  test('[Review Focus] lote com o prazo no passado: quem já está continua entrando', async () => {
    await L.alterarLote(lote.id, { validoAte: new Date(Date.now() - 864e5) }, 'dev');
    assert.equal((await req(base, ana)).status, 200);
    await L.alterarLote(lote.id, { validoAte: new Date(Date.now() + 30 * 864e5) }, 'dev');
  });

  test('painel → alunos: origem "Escola: <nome>"', async () => {
    await req(base, ana); // abre o curso: cria o AlunoCursoEad
    const lista = await rel.alunosDoCurso(co.id);
    const a = lista.find((l) => l.usuario.email === ana.email);
    assert.equal(a.origem, `Escola: Escola Acesso ${sufixo}`);
  });
});
