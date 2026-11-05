// Painel do EAD, etapa 4: alunos (pagos e do link de teste), detalhe e concluintes. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const DIA = 864e5;

describe('ead-relatorios', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const rel = require('../src/lib/ead-relatorios');
  const cert = require('../src/lib/certificado');
  const { turmaOnline } = require('../src/lib/turma-online');
  let curso; let co; let m1; let m2; let tela1; let tela2; let turma; const u = {}; const ac = {};
  let server; let painel;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE relatórios online', cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9, publicado: true } });
    m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    const t1 = await prisma.topicoEad.create({ data: { moduloId: m1.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } }, include: { telas: true } });
    m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M2', ordem: 1, status: 'VALIDADO' } });
    const t2 = await prisma.topicoEad.create({ data: { moduloId: m2.id, titulo: 'T2', telas: { create: [{ titulo: 'tela 2' }] } }, include: { telas: true } });
    tela1 = t1.telas[0]; tela2 = t2.telas[0];
    turma = await turmaOnline(co);
    for (const n of ['ana', 'bia', 'caio', 'duda']) u[n] = await prisma.usuario.create({ data: { nome: `${n[0].toUpperCase()}${n.slice(1)} Relatório`, email: `${n}-rel-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    const mat = (x, status, confirmadaEm) => prisma.matricula.create({ data: { alunoId: x.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, taxaConfirmada: true, statusPagamento: status, confirmadaEm } });
    await mat(u.ana, 'PAGO', new Date(Date.now() - 10 * DIA));
    await mat(u.bia, 'PAGO', new Date(Date.now() - 3 * DIA));
    await mat(u.caio, 'CANCELADO', null);
    // Ana: pagou há 10 dias, viu tudo e concluiu (com número e código da Redação)
    ac.ana = await prisma.alunoCursoEad.create({ data: { usuarioId: u.ana.id, cursoOnlineId: co.id, iniciadoEm: new Date(Date.now() - 9 * DIA), concluidoEm: new Date(Date.now() - DIA) } });
    for (const t of [tela1, tela2]) await prisma.telaVistaEad.create({ data: { alunoCursoId: ac.ana.id, telaId: t.id, vistaEm: new Date(Date.now() - DIA) } });
    await cert.numerarEad(ac.ana.id);
    await prisma.logAuditoria.create({ data: { id: `cert-redacao-${ac.ana.id}`, atorId: 'SISTEMA', acao: 'CERTIFICADO_REDACAO', alvoTipo: 'AlunoCursoEad', alvoId: ac.ana.id, detalhe: { codigo: 'ABCD-EFGH', url: 'https://redacao.exemplo/certificado/ABCD-EFGH' } } });
    // Bia: pagou há 3 dias, viu só a tela 1 (M1 concluído) há 2 horas
    ac.bia = await prisma.alunoCursoEad.create({ data: { usuarioId: u.bia.id, cursoOnlineId: co.id } });
    await prisma.telaVistaEad.create({ data: { alunoCursoId: ac.bia.id, telaId: tela1.id, vistaEm: new Date(Date.now() - 2 * 3600e3) } });
    // Duda: só pelo link de teste, começou há 10 dias
    ac.duda = await prisma.alunoCursoEad.create({ data: { usuarioId: u.duda.id, cursoOnlineId: co.id, iniciadoEm: new Date(Date.now() - 10 * DIA) } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.documentoAluno = () => null;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      req.session = { usuarioId: null };
      Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev Teste', papel: 'DEV' } });
      next();
    });
    app.use(require('../src/routes/ead')({ requireDev: (req, res, next) => next(), auditar: async () => {}, ADMIN_URL: '' }));
    await new Promise((r) => { server = app.listen(0, r); });
    painel = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: Object.values(ac).map((a) => a.id) } } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: Object.values(u).map((x) => x.id) } } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const nomes = (lista) => lista.map((l) => l.usuario.nome.split(' ')[0]).sort();

  test('alunosDoCurso: pagos e do link de teste, com origem, pagamento, %, fase e último acesso', async () => {
    const todos = await rel.alunosDoCurso(co.id);
    assert.deepEqual(nomes(todos), ['Ana', 'Bia', 'Caio', 'Duda']);
    const por = Object.fromEntries(todos.map((l) => [l.usuario.nome.split(' ')[0], l]));
    assert.equal(por.Ana.origem, 'Pago'); assert.equal(por.Duda.origem, 'Teste');
    assert.equal(por.Ana.pagamento, 'PAGO'); assert.equal(por.Caio.pagamento, 'CANCELADO'); assert.equal(por.Duda.pagamento, null);
    assert.equal(por.Ana.percentual, 100); assert.equal(por.Bia.percentual, 50); assert.equal(por.Caio.percentual, 0); assert.equal(por.Duda.percentual, 0);
    assert.equal(por.Bia.fase, 'Nos 7 dias'); assert.equal(por.Ana.fase, 'Livre'); assert.equal(por.Duda.fase, 'Livre');
    assert.ok(Math.abs(new Date(por.Bia.ultimoAcesso) - (Date.now() - 2 * 3600e3)) < 60e3);
    assert.equal(por.Caio.ultimoAcesso, null); assert.equal(por.Caio.alunoCursoId, null);
    assert.ok(por.Ana.concluidoEm); assert.equal(por.Bia.concluidoEm, null);
    assert.ok(por.Ana.inscricaoEm);
  });

  test('filtros: em andamento, concluídos, cancelados', async () => {
    assert.deepEqual(nomes(await rel.alunosDoCurso(co.id, { filtro: 'andamento' })), ['Bia', 'Duda']);
    assert.deepEqual(nomes(await rel.alunosDoCurso(co.id, { filtro: 'concluidos' })), ['Ana']);
    assert.deepEqual(nomes(await rel.alunosDoCurso(co.id, { filtro: 'cancelados' })), ['Caio']);
  });

  test('detalheDoAluno: progresso por módulo e tópico; outro curso ⇒ null', async () => {
    const d = await rel.detalheDoAluno(co.id, ac.bia.id);
    assert.equal(d.usuario.nome, 'Bia Relatório');
    assert.equal(d.estado.percentual, 50);
    assert.equal(d.estado.modulos[0].estado, 'concluido');
    assert.deepEqual(d.tentativas, []); assert.deepEqual(d.cenarios, []);
    assert.equal(await rel.detalheDoAluno('00000000-0000-4000-8000-000000000000', ac.bia.id), null);
  });

  test('concluintesDoCurso: Livro/Registro e código da Redação', async () => {
    const c = await rel.concluintesDoCurso(co.id);
    assert.equal(c.length, 1);
    assert.equal(c[0].alunoCursoId, ac.ana.id); assert.equal(c[0].nome, 'Ana Relatório');
    assert.ok(c[0].livro); assert.ok(c[0].registro); assert.equal(c[0].codigoRedacao, 'ABCD-EFGH');
  });

  test('telas do painel: alunos (com filtro), detalhe, concluintes e "Abrir certificado"', async () => {
    const lista = await (await fetch(`${painel}/ead/curso/${co.id}/alunos?filtro=concluidos`)).text();
    assert.match(lista, /Ana Relatório/); assert.doesNotMatch(lista, /Bia Relatório/);
    const det = await fetch(`${painel}/ead/curso/${co.id}/alunos/${ac.bia.id}`);
    assert.equal(det.status, 200); assert.match(await det.text(), /50%/);
    assert.equal((await fetch(`${painel}/ead/curso/${co.id}/alunos/00000000-0000-4000-8000-000000000000`)).status, 404);
    const conc = await (await fetch(`${painel}/ead/curso/${co.id}/concluintes`)).text();
    assert.match(conc, /Ana Relatório/); assert.match(conc, /ABCD-EFGH/);
    const c = await fetch(`${painel}/ead/curso/${co.id}/concluintes/${ac.ana.id}/certificado`);
    assert.equal(c.status, 200);
    const html = await c.text();
    assert.match(html, /CURSO ONLINE/); assert.match(html, /Ana Relatório/);
    assert.doesNotMatch(html, /Baixar cartão de bolso/); // sem a barra do aluno
    assert.equal((await fetch(`${painel}/ead/curso/${co.id}/concluintes/${ac.bia.id}/certificado`)).status, 404);
  });
});
