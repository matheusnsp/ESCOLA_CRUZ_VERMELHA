// Etapa 8: travas da compra ("Liberar curso" e PIX ao mesmo tempo) e do lote (datas, criação tudo ou nada,
// vagas sob a trava). Postgres LOCAL; gateway e e-mails falsos.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('travas da compra e do lote', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const email = require('../src/lib/email');
  email.enviarGestorEscola = async () => {}; email.enviarVagaLiberada = async () => {}; email.enviarCursoOnlineLiberado = async () => {};
  require('../src/lib/unicopag').criarTransacao = async () => { await new Promise((r) => setTimeout(r, 30)); return { gatewayRef: `falso-trava-${Date.now()}-${Math.random()}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR' }; };
  const L = require('../src/lib/ead-lote');
  const s = String(Date.now()).slice(-7);
  let server; let base; let curso; let co; let cupom;
  const hojeRio = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const gestor = (x) => ({ nome: `Gestor Trava ${x}`, email: `g${x}-trava-${s}@teste.local`, celular: '', cpf: cpf() });
  const loteBase = (x, extra = {}) => ({ escola: { nome: `Escola Trava ${x} ${s}` }, cursoOnlineId: co.id, vagas: 3, validoAte: new Date(Date.now() + 864e5), valor: 100, forma: 'PIX', gestor: gestor(x), atorId: 'dev', ...extra });

  let restaurarEd; // Escola Digital começa desligada (2026-11): liga para o teste e devolve no fim

  before(async () => { restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital(); });

  after(async () => { if (restaurarEd) await restaurarEd(); });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Trava ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 50, publicado: true } });
    cupom = await prisma.cupomEad.create({ data: { codigo: `TRAVA${s}`, tipo: 'PERCENTUAL', valor: 100, criadoPor: 'dev' } });
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const id = req.get('x-teste-usuario'); if (id) { req.session.usuarioId = id; req.session.papel = 'ALUNO'; } next(); });
    app.use(require('../src/routes/ead-online'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/online/${curso.id}`;
  });
  after(async () => {
    server.close();
    const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: curso.id } }, select: { id: true } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: cupom.id } });
    await prisma.matricula.deleteMany({ where: { turma: { cursoId: curso.id } } });
    await prisma.cupomEad.delete({ where: { id: cupom.id } });
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    const lotes = await prisma.loteEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: lotes.map((l) => l.id) } } });
    await prisma.vagaLoteEad.deleteMany({ where: { loteId: { in: lotes.map((l) => l.id) } } });
    await prisma.loteEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.escolaEad.deleteMany({ where: { nome: { endsWith: ` ${s}` } } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-trava-${s}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const post = (u, corpo) => fetch(`${base}/comprar`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-teste-usuario': u.id } });

  test('"Liberar curso" e PIX ao mesmo tempo: a matrícula termina PAGO, R$ 0', async () => {
    for (let i = 0; i < 10; i++) {
      const u = await prisma.usuario.create({ data: { nome: `Aluno Trava ${i}`, email: `a${i}-trava-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
      await post(u, { forma: 'PIX' }); // já tem uma matrícula PENDENTE
      await Promise.all([post(u, { forma: 'CUPOM', cupom: cupom.codigo }), post(u, { forma: 'PIX' })]);
      const m = await prisma.matricula.findFirst({ where: { alunoId: u.id, turma: { cursoId: curso.id } } });
      assert.equal(m.statusPagamento, 'PAGO', `rodada ${i}`);
      assert.equal(Number(m.valorCurso), 0, `rodada ${i}`);
    }
  });

  test('lote: recebido no futuro ⇒ recusa; hoje ⇒ aceita; prazo vencido ⇒ recusa', async () => {
    const amanha = new Date(`${hojeRio()}T12:00:00-03:00`); amanha.setDate(amanha.getDate() + 1);
    assert.deepEqual(await L.criarLote(loteBase('fut', { recebidoEm: amanha })), { ok: false, erro: 'A data de recebimento não pode ser no futuro.' });
    const hoje = await L.criarLote(loteBase('hoje', { recebidoEm: new Date(`${hojeRio()}T12:00:00-03:00`) }));
    assert.equal(hoje.ok, true, hoje.erro);
    assert.deepEqual(await L.criarLote(loteBase('venc', { validoAte: new Date(Date.now() - 864e5) })), { ok: false, erro: 'O prazo precisa ser uma data futura.' });
    assert.deepEqual(await L.alterarLote(hoje.lote.id, { recebidoEm: amanha }, 'dev'), { ok: false, erro: 'A data de recebimento não pode ser no futuro.' });
  });

  test('lote que falha na gravação não deixa escola nem conta de gestor sobrando', async () => {
    const g = gestor('falha');
    const r = await L.criarLote(loteBase('falha', { valor: 1e9, gestor: g })).catch((e) => ({ ok: false, erro: e.message }));
    assert.equal(r.ok, false);
    assert.equal(await prisma.escolaEad.count({ where: { nome: `Escola Trava falha ${s}` } }), 0);
    assert.equal(await prisma.usuario.count({ where: { email: g.email } }), 0);
  });

  test('reduzir vagas e ocupar ao mesmo tempo: vagas nunca abaixo das usadas', async () => {
    for (let i = 0; i < 5; i++) {
      const { lote } = await L.criarLote(loteBase(`vag${i}`));
      const us = await Promise.all([0, 1].map((k) => prisma.usuario.create({ data: { nome: `Func Trava ${i}${k}`, email: `f${i}${k}-trava-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } })));
      await Promise.all([L.alterarLote(lote.id, { vagas: 1 }, 'dev'), ...us.map((u) => L.entrarPorConvite(lote.convite, u.id))]);
      const depois = await prisma.loteEad.findUnique({ where: { id: lote.id } });
      const usadas = await prisma.vagaLoteEad.count({ where: { loteId: lote.id, removidaEm: null } });
      assert.ok(depois.vagas >= usadas, `rodada ${i}: ${depois.vagas} vagas, ${usadas} usadas`);
    }
  });
});
