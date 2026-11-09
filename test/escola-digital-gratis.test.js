// Escola Digital — vitrine (fase 1, 2026-11-09), Task 3: liberar curso gratuito (só com conta) e "Minha conta".
// Spec: docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md §4. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('curso gratuito no site', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const ed = require('../src/lib/escola-digital');
  const vitrine = require('../src/lib/vitrine');
  const { turmaOnline } = require('../src/lib/turma-online');
  const { meusCursosOnline } = require('../src/lib/ead-meus-cursos');
  const s = String(Date.now()).slice(-7);
  let server; let site; let restaurarEd;
  let cG; let coG; let cP; let coP; let cN; let coN; let semCpf; let pendente; let dev;
  const urlG = () => vitrine.urlOnline(cG);

  const cab = (u, papel = 'ALUNO') => (u ? { 'x-teste-usuario': u, 'x-teste-papel': papel } : {});
  const get = async (u, quem, papel) => (await fetch(site + u, { headers: cab(quem, papel) })).text();
  const liberar = (url, quem, papel) => fetch(`${site}${url}/comprar`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...cab(quem, papel) },
    body: new URLSearchParams({ forma: 'GRATIS' }).toString(),
  });
  const matriculas = (alunoId, cursoId) => prisma.matricula.findMany({ where: { alunoId, turma: { cursoId } } });

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    const curso = (nome) => prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    cG = await curso('Gratis Site'); cP = await curso('Pago Site'); cN = await curso('Gratis Rascunho');
    coG = await prisma.cursoOnline.create({ data: { cursoId: cG.id, precoOnline: 0, gratuito: true, publicado: true, somenteOnline: true } });
    coP = await prisma.cursoOnline.create({ data: { cursoId: cP.id, precoOnline: 30, publicado: true, somenteOnline: true } });
    coN = await prisma.cursoOnline.create({ data: { cursoId: cN.id, precoOnline: 0, gratuito: true, publicado: false, somenteOnline: true } });
    for (const co of [coG, coP, coN]) {
      const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', status: 'VALIDADO' } });
      await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    }
    semCpf = await prisma.usuario.create({ data: { nome: 'Sem CPF Gratis', email: `semcpf-${s}@teste.local`, papel: 'ALUNO' } });
    pendente = await prisma.usuario.create({ data: { nome: 'Pendente Gratis', email: `pend-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    dev = await prisma.usuario.create({ data: { nome: 'Dev Gratis', email: `dev-${s}@teste.local`, papel: 'DEV' } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = vitrine.urlCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use(async (req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = req.get('x-teste-papel'); }
      Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo', escolaDigital: await ed.estaLigada() });
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    app.use((r, res) => res.status(404).send('404'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    if (restaurarEd) await restaurarEd();
    const ids = [semCpf.id, pendente.id, dev.id];
    const ms = await prisma.matricula.findMany({ where: { alunoId: { in: ids } }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    await prisma.turma.deleteMany({ where: { cursoId: { in: [cG.id, cP.id, cN.id] } } });
    await prisma.alunoCursoEad.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.logAuditoria.deleteMany({ where: { atorId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    const cos = [coG.id, coP.id, coN.id];
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: { in: cos } } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: { in: cos } } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: cos } } });
    await prisma.curso.deleteMany({ where: { id: { in: [cG.id, cP.id, cN.id] } } });
  });

  test('conta obrigatória: visitante vai para o login e nada é gravado; a capa só oferece criar conta', async () => {
    const antes = await prisma.matricula.count();
    const r = await liberar(urlG());
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /\/login/);
    assert.equal(await prisma.matricula.count(), antes);
    const capa = await get(urlG());
    assert.match(capa, /Criar conta e liberar/);
    assert.doesNotMatch(capa, /Quero estudar/);
    assert.match(capa, /<h2>Grátis<span[^>]*>\.<\/span><\/h2>/);
  });

  test('capa do aluno logado: Grátis, "Quero estudar · Grátis", sem cupom nem PIX (mesmo com ?cupom=)', async () => {
    for (const u of [urlG(), `${urlG()}?cupom=QUALQUER`]) {
      const capa = await get(u, semCpf.id);
      assert.match(capa, /<h2>Grátis<span[^>]*>\.<\/span><\/h2>/);
      assert.match(capa, /Quero estudar · Grátis/);
      assert.match(capa, /name="forma" value="GRATIS"/);
      assert.doesNotMatch(capa, /name="cupom"/);
      assert.doesNotMatch(capa, /value="PIX"/);
      assert.doesNotMatch(capa, /Cupom .* aplicado/);
    }
  });

  test('aluno sem CPF libera com um clique; duplo clique = uma matrícula e uma auditoria', async () => {
    const [r1, r2] = await Promise.all([liberar(urlG(), semCpf.id), liberar(urlG(), semCpf.id)]);
    for (const r of [r1, r2]) { assert.equal(r.status, 302); assert.match(r.headers.get('location'), /\/continuar$/); }
    const ms = await matriculas(semCpf.id, cG.id);
    assert.equal(ms.length, 1);
    assert.equal(ms[0].statusPagamento, 'PAGO');
    assert.equal(Number(ms[0].valorCurso), 0);
    assert.equal(ms[0].confirmadaPor, 'gratuito');
    assert.equal(await prisma.pagamento.count({ where: { matriculaId: ms[0].id } }), 0);
    assert.equal(await prisma.logAuditoria.count({ where: { atorId: semCpf.id, acao: 'EAD_GRATIS_LIBEROU' } }), 1);
  });

  test('GRATIS não libera curso pago, curso não publicado, Escola Digital desligada nem DEV', async () => {
    await liberar(vitrine.urlOnline(cP), pendente.id);
    assert.equal((await matriculas(pendente.id, cP.id)).length, 0, 'pago');
    await liberar(vitrine.urlOnline(cN), pendente.id);
    assert.equal((await matriculas(pendente.id, cN.id)).length, 0, 'não publicado');
    await prisma.configuracao.update({ where: { chave: ed.CHAVE }, data: { valor: '0' } }); ed.limparCache();
    try {
      await liberar(urlG(), pendente.id);
      assert.equal((await matriculas(pendente.id, cG.id)).length, 0, 'desligada');
    } finally {
      await prisma.configuracao.update({ where: { chave: ed.CHAVE }, data: { valor: '1' } }); ed.limparCache();
    }
    await liberar(urlG(), dev.id, 'DEV');
    assert.equal((await matriculas(dev.id, cG.id)).length, 0, 'DEV');
  });

  test('PIX pendente de curso que virou grátis: libera e cancela o pagamento', async () => {
    await prisma.cursoOnline.update({ where: { id: coP.id }, data: { gratuito: true, precoOnline: 0 } });
    try {
      const turma = await turmaOnline(coP);
      const m = await prisma.matricula.create({ data: { alunoId: pendente.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 30, valorTaxaMatricula: 0, statusPagamento: 'PENDENTE' } });
      const pg = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', metodo: 'PIX', valor: 30, status: 'PENDENTE', gateway: 'unicopag' } });
      const capa = await get(vitrine.urlOnline(cP), pendente.id);
      assert.match(capa, /Quero estudar · Grátis/);
      const r = await liberar(vitrine.urlOnline(cP), pendente.id);
      assert.match(r.headers.get('location'), /\/continuar$/);
      assert.equal((await prisma.matricula.findUnique({ where: { id: m.id } })).statusPagamento, 'PAGO');
      assert.equal((await prisma.pagamento.findUnique({ where: { id: pg.id } })).status, 'CANCELADO');
    } finally {
      await prisma.cursoOnline.update({ where: { id: coP.id }, data: { gratuito: false, precoOnline: 30 } });
    }
  });

  test('Minha conta: origem "Gratuito", e continua com o curso depois que ele volta a ser pago', async () => {
    let item = (await meusCursosOnline(semCpf.id)).find((c) => c.cursoId === cG.id);
    assert.equal(item.origem, 'gratuito');
    await prisma.cursoOnline.update({ where: { id: coG.id }, data: { gratuito: false, precoOnline: 30 } });
    try {
      item = (await meusCursosOnline(semCpf.id)).find((c) => c.cursoId === cG.id);
      assert.equal(item.origem, 'gratuito');
      assert.notEqual(item.situacao, 'pendente');
      const capa = await get(urlG(), semCpf.id);
      assert.doesNotMatch(capa, /Comprar ·/, 'não pede para comprar de novo');
    } finally {
      await prisma.cursoOnline.update({ where: { id: coG.id }, data: { gratuito: true, precoOnline: 0 } });
    }
    const fonte = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'views', 'minha-conta.ejs'), 'utf8');
    assert.match(fonte, /c\.origem === 'gratuito' \? 'Gratuito'/);
  });
});
