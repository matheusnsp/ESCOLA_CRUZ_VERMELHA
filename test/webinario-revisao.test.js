// Webinários (2026-11-13): correções da revisão final (I-1, I-2, I-3, M-1, M-2).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ouvir } = require('./helpers/painel-ead');

test('I-2: confirmar pagamento à mão no painel cria a inscrição do webinário (webinario-avisos.inscricaoPaga)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  const rota = src.slice(src.indexOf("router.post('/inscricoes/:id/confirmar'"), src.indexOf("router.post('/inscricoes/:id/cancelar'"));
  assert.match(rota, /webinario-avisos'\)\.inscricaoPaga\(m\.id\)/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('revisão final (banco)', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const email = require('../src/lib/email');
  const redacao = require('../src/lib/redacao');
  const s = String(Date.now()).slice(-7);
  const criados = []; let ana; const enviados = [];
  const orig = { l: email.enviarWebinarLembrete, c: email.enviarWebinarConfirmado, r: redacao.registrarCertificados };
  before(async () => {
    email.enviarWebinarLembrete = async (para, n, d) => { enviados.push(['lembrete', para, d.falta]); };
    email.enviarWebinarConfirmado = async (para) => { enviados.push(['confirmado', para]); };
    redacao.registrarCertificados = async () => ({ codigos: {}, falhas: 0 });
    ana = await prisma.usuario.create({ data: { nome: 'Ana Revisão', email: `ana-rv-${s}@teste.local`, papel: 'ALUNO' } });
  });
  after(async () => {
    Object.assign(email, { enviarWebinarLembrete: orig.l, enviarWebinarConfirmado: orig.c }); redacao.registrarCertificados = orig.r;
    const pres = await prisma.presencaWebinario.findMany({ where: { usuarioId: ana.id }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: pres.map((p) => p.id) } } });
    for (const w of criados) {
      const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: w.cursoId } }, select: { id: true } });
      await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    }
    await prisma.usuario.delete({ where: { id: ana.id } });
    for (const w of criados) await wb.excluir(w.id).catch(() => {});
    await prisma.$disconnect();
  });
  const cria = async (o) => { const w = (await wb.salvar({ duracaoMin: '60', palavraCodigo: 'x', ...o })).webinario; criados.push(w); return w; };

  test('I-1: despublicado (para fechar inscrições) ainda manda os lembretes aos inscritos', async () => {
    const w = await cria({ nome: `Fechado ${s}`, gratuito: '1', inicioEm: '2031-10-10T19:00' });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: ana.id, criadoEm: new Date('2031-10-01T12:00:00Z') } });
    await require('../src/lib/webinario-lembretes').processarLembretesWebinario(new Date('2031-10-09T23:00:00Z'));
    assert.ok(enviados.some((e) => e[0] === 'lembrete' && e[1] === ana.email && e[2] === '24h'));
  });

  test('M-2: comprar de novo depois do estorno (inscrição antiga existe) manda a confirmação e zera os lembretes', async () => {
    enviados.length = 0;
    const w = await cria({ nome: `Recompra ${s}`, preco: '10', inicioEm: '2031-10-12T19:00' });
    const turma = await require('../src/lib/turma-online').turmaOnline({ cursoId: w.cursoId });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: ana.id, lembrete24hEm: new Date() } });
    const m = await prisma.matricula.create({ data: { alunoId: ana.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 10, valorTaxaMatricula: 0, taxaConfirmada: true, statusPagamento: 'PAGO' } });
    assert.equal(await require('../src/lib/webinario-avisos').inscricaoPaga(m.id), true);
    assert.deepEqual(enviados, [['confirmado', ana.email]]);
    assert.equal((await prisma.inscricaoWebinario.findFirst({ where: { webinarioId: w.id, usuarioId: ana.id } })).lembrete24hEm, null);
  });

  test('M-1: remarcar depois do evento não muda a data do certificado já emitido', async () => {
    const w = await cria({ nome: `Remarcado ${s}`, gratuito: '1', inicioEm: '2026-11-01T19:00', publicado: '1' });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: ana.id } });
    const r = await wb.confirmarPresenca(ana.id, w, 'x', new Date('2026-11-01T23:00:00Z'));
    assert.equal(r.ok, true);
    await prisma.webinario.update({ where: { id: w.id }, data: { inicioEm: new Date('2026-12-05T22:00:00Z') } });
    const p = await prisma.presencaWebinario.findFirst({ where: { webinarioId: w.id, usuarioId: ana.id } });
    const c = await require('../src/lib/webinario-certificado').emitirCertificadoWebinario(p.id, {});
    assert.equal(c.dados.webinario.data, '01/11/2026');
  });

  test('I-3: painel abre o certificado de quem tem presença (link na lista de inscritos)', async () => {
    const w = criados[criados.length - 1];
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.use((req, res, next) => { req.session = { usuarioId: 'dev' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: 'dev' }, modo: 'online' }); next(); });
    app.use(require('../src/routes/ead-webinarios')({ requireDev: (req, res, next) => next(), auditar: async () => {} }));
    const srv = await ouvir(app);
    try {
      const p = await prisma.presencaWebinario.findFirst({ where: { webinarioId: w.id, usuarioId: ana.id } });
      const lista = await (await fetch(`${srv.url}/ead/webinarios/${w.id}/inscritos`)).text();
      assert.match(lista, new RegExp(`/ead/webinarios/${w.id}/certificado/${p.id}`));
      const h = await (await fetch(`${srv.url}/ead/webinarios/${w.id}/certificado/${p.id}`)).text();
      assert.match(h, /WEBINÁRIO/); assert.match(h, /Ana Revisão/);
    } finally { srv.server.close(); }
  });
});
