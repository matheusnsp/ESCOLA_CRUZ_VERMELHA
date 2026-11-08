// Escola Digital (2026-11), Task 6: aba própria dos cursos online, com interruptor no painel.
// Ligada: menu, /escola-digital, /escola-digital/<curso>; o catálogo /cursos fica só presencial; aviso no presencial.
// Desligada: some para quem visita; quem tem acesso (comprou, vaga de escola) continua. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');
const vitrine = require('../src/lib/vitrine');

test('urlOnline: /escola-digital/<nome do curso>', () => {
  assert.equal(vitrine.urlOnline({ nome: 'Primeiros Socorros na Escola' }), '/escola-digital/primeiros-socorros-na-escola');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('Escola Digital', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const ed = require('../src/lib/escola-digital');
  const cacheRapido = require('../src/lib/cache-rapido');
  const { turmaOnline } = require('../src/lib/turma-online');
  const s = String(Date.now()).slice(-7);
  let server; let site; let antes;
  let soOnline; let coSo; let presencial; let coPres; let comprador; let funcionario; let escola; let lote;
  const slugSo = `escola-digital-so-${s}`;
  const req = { session: { usuarioId: `dev-ed-${s}` }, ip: '127.0.0.1' };

  const texto = async (u, usuarioId) => (await fetch(site + u, { headers: usuarioId ? { 'x-teste-usuario': usuarioId } : {} })).text();
  const status = async (u, usuarioId) => (await fetch(site + u, { redirect: 'manual', headers: usuarioId ? { 'x-teste-usuario': usuarioId } : {} })).status;
  const ligar = async (v) => { await prisma.configuracao.upsert({ where: { chave: ed.CHAVE }, update: { valor: v ? '1' : '0' }, create: { chave: ed.CHAVE, valor: v ? '1' : '0' } }); ed.limparCache(); cacheRapido.limparTudo(); };

  before(async () => {
    antes = await prisma.configuracao.findUnique({ where: { chave: ed.CHAVE } });
    await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE } }); ed.limparCache();
    soOnline = await prisma.curso.create({ data: { nome: `Escola Digital So ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    coSo = await prisma.cursoOnline.create({ data: { cursoId: soOnline.id, precoOnline: 30, publicado: true, somenteOnline: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: coSo.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    presencial = await prisma.curso.create({ data: { nome: `Presencial Com Online ${s}`, cargaHoraria: 8, precoAvista: 100, precoCheio: 120, valorParcela: 40, ativo: true } });
    coPres = await prisma.cursoOnline.create({ data: { cursoId: presencial.id, precoOnline: 50, publicado: true } });
    comprador = await prisma.usuario.create({ data: { nome: 'Comprador ED', email: `comp-ed-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    const turma = await turmaOnline(coSo);
    await prisma.matricula.create({ data: { alunoId: comprador.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 30, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true, confirmadaEm: new Date() } });
    funcionario = await prisma.usuario.create({ data: { nome: 'Funcionario ED', email: `func-ed-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    escola = await prisma.escolaEad.create({ data: { nome: `Escola ED ${s}` } });
    lote = await prisma.loteEad.create({ data: { escolaId: escola.id, cursoOnlineId: coSo.id, vagas: 5, validoAte: new Date(Date.now() + 30 * 864e5), valor: 0, forma: 'PIX', criadoPor: 'teste', convite: `convite-escola-digital-${s}` } });
    await prisma.vagaLoteEad.create({ data: { loteId: lote.id, usuarioId: funcionario.id, origem: 'GESTOR' } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = vitrine.urlCurso;
    app.locals.requisitoCurso = vitrine.requisitoCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use(async (req2, res, next) => {
      const id = req2.get('x-teste-usuario');
      if (id) { req2.session.usuarioId = id; req2.session.papel = 'ALUNO'; }
      Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo', escolaDigital: await ed.estaLigada() });
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-escola'));
    app.use(require('../src/routes/ead-teste'));
    app.use(require('../src/routes/cursos'));
    app.use((r, res) => res.status(404).send('404'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE } });
    if (antes) await prisma.configuracao.create({ data: { chave: antes.chave, valor: antes.valor } });
    ed.limparCache();
    const turmas = await prisma.turma.findMany({ where: { cursoId: { in: [soOnline.id, presencial.id] } }, select: { id: true } });
    const ms = await prisma.matricula.findMany({ where: { turmaId: { in: turmas.map((t) => t.id) } }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    await prisma.turma.deleteMany({ where: { id: { in: turmas.map((t) => t.id) } } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: { in: [coSo.id, coPres.id] } } });
    await prisma.loteEad.deleteMany({ where: { id: lote.id } });
    await prisma.escolaEad.delete({ where: { id: escola.id } });
    await prisma.logAuditoria.deleteMany({ where: { acao: { startsWith: 'ESCOLA_DIGITAL_' }, atorId: req.session.usuarioId } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: coSo.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: coSo.id } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: [coSo.id, coPres.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [soOnline.id, presencial.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [comprador.id, funcionario.id] } } });
    await prisma.$disconnect();
  });

  test('padrão é desligada', async () => {
    assert.equal(await ed.estaLigada(), false);
  });

  test('ligar sem curso publicado é recusado; ligar e desligar gravam auditoria', async () => {
    await prisma.cursoOnline.updateMany({ where: { id: { in: [coSo.id, coPres.id] } }, data: { publicado: false } });
    const outros = await prisma.cursoOnline.findMany({ where: { publicado: true }, select: { id: true } });
    await prisma.cursoOnline.updateMany({ where: { id: { in: outros.map((o) => o.id) } }, data: { publicado: false } });
    try {
      assert.deepEqual(await ed.definirLigada(true, req), { erro: 'Publique um curso antes de ligar a Escola Digital.' });
    } finally {
      await prisma.cursoOnline.updateMany({ where: { id: { in: [coSo.id, coPres.id, ...outros.map((o) => o.id)] } }, data: { publicado: true } });
    }
    assert.deepEqual(await ed.definirLigada(true, req), {});
    assert.equal(await ed.estaLigada(), true);
    assert.deepEqual(await ed.definirLigada(false, req), {});
    assert.equal(await ed.estaLigada(), false);
    const logs = await prisma.logAuditoria.findMany({ where: { atorId: req.session.usuarioId, acao: { startsWith: 'ESCOLA_DIGITAL_' } } });
    assert.deepEqual(logs.map((l) => l.acao).sort(), ['ESCOLA_DIGITAL_DESLIGOU', 'ESCOLA_DIGITAL_LIGOU']);
  });

  test('desligada: /escola-digital é 404 e o menu não tem o item', async () => {
    await ligar(false);
    assert.equal(await status('/escola-digital'), 404);
    assert.doesNotMatch(await texto('/cursos'), />Escola Digital</);
  });

  test('desligada: visitante na página de venda vê "não está disponível" e não vê "Comprar"', async () => {
    await ligar(false);
    const t = await texto(`/escola-digital/${slugSo}`);
    assert.match(t, /Este curso não está disponível no momento/);
    assert.doesNotMatch(t, /Comprar/);
    assert.match(await texto(`/online/${slugSo}`), /Este curso não está disponível no momento/);
  });

  test('desligada: quem comprou abre /escola-digital/<curso> e as telas', async () => {
    await ligar(false);
    const t = await texto(`/escola-digital/${slugSo}`, comprador.id);
    assert.doesNotMatch(t, /não está disponível/);
    assert.match(t, /M1/);
  });

  test('desligada: funcionário de escola abre pelo convite e por /escola-digital/<curso>', async () => {
    await ligar(false);
    assert.doesNotMatch(await texto(`/escola-digital/${slugSo}`, funcionario.id), /não está disponível/);
    const r = await fetch(`${site}/escola/convite/${lote.convite}`, { redirect: 'manual', headers: { 'x-teste-usuario': funcionario.id } });
    assert.ok([200, 302].includes(r.status));
    if (r.status === 302) assert.match(r.headers.get('location'), /\/escola-digital\//);
  });

  test('ligada: /escola-digital lista os publicados e o menu tem o item', async () => {
    await ligar(true);
    const t = await texto('/escola-digital');
    assert.match(t, /Escola Digital CVB-RJ/);
    assert.match(t, new RegExp(`Escola Digital So ${s}`));
    assert.match(t, new RegExp(`Presencial Com Online ${s}`));
    assert.match(await texto('/cursos'), /href="\/escola-digital"[^>]*>Escola Digital</);
  });

  test('/online/<slug> e /online/<uuid> abrem com canonical para /escola-digital/<slug>', async () => {
    await ligar(true);
    for (const u of [`/online/${slugSo}`, `/online/${soOnline.id}`]) {
      const r = await fetch(site + u, { redirect: 'manual' });
      assert.equal(r.status, 200, u);
      assert.match(await r.text(), new RegExp(`<link rel="canonical" href="[^"]*/escola-digital/${slugSo}">`), u);
    }
  });

  test('catálogo /cursos não tem curso só online nem "100% online"', async () => {
    await ligar(true);
    const t = await texto('/cursos');
    assert.doesNotMatch(t, new RegExp(`Escola Digital So ${s}`));
    assert.doesNotMatch(t, /100% online/);
  });

  test('presencial com online: aviso só com a Escola Digital ligada', async () => {
    await ligar(true);
    assert.match(await texto(vitrine.urlCurso(presencial)), /também existe 100% online, na Escola Digital/);
    await ligar(false);
    const t = await texto(vitrine.urlCurso(presencial));
    assert.doesNotMatch(t, /Escola Digital/);
    assert.doesNotMatch(t, /\/escola-digital\//);
  });

  test('sitemap tem /escola-digital/<curso> só ligada', async () => {
    await ligar(true);
    assert.match(await texto('/sitemap.xml'), new RegExp(`/escola-digital/${slugSo}<`));
    await ligar(false);
    assert.doesNotMatch(await texto('/sitemap.xml'), /escola-digital/);
  });

  test('compra por /escola-digital/<curso>/comprar cria a matrícula', async () => {
    await ligar(true);
    const u = await prisma.usuario.create({ data: { nome: 'Compra ED', email: `compra-ed-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    try {
      const r = await fetch(`${site}/escola-digital/${slugSo}/comprar`, { method: 'POST', redirect: 'manual', headers: { 'x-teste-usuario': u.id, 'content-type': 'application/x-www-form-urlencoded' }, body: 'forma=PIX' });
      assert.equal(r.status, 302);
      assert.equal(await prisma.matricula.count({ where: { alunoId: u.id } }), 1);
    } finally {
      const ms = await prisma.matricula.findMany({ where: { alunoId: u.id }, select: { id: true } });
      await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
      await prisma.matricula.deleteMany({ where: { alunoId: u.id } });
      await prisma.usuario.delete({ where: { id: u.id } });
    }
  });
});
