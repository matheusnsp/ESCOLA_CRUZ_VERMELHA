// Webinários (2026-11-13; spec §1, §3, §8): webinário pago (gateway falso), confirmação, estorno e cupons.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); } return d.join(''); };
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('webinário pago e cupons', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const cupons = require('../src/lib/ead-cupom');
  const unicopag = require('../src/lib/unicopag');
  const email = require('../src/lib/email');
  const { aplicarStatus } = require('../src/lib/status-pagamento');
  const s = String(Date.now()).slice(-7);
  const LINK = `https://zoom.us/j/pago${s}`;
  let server; let site; let w; let outro; let ana; let restaurarEd; let agoraOrig; const avisos = []; const criados = [];
  const orig = { criar: unicopag.criarTransacao, conf: email.enviarWebinarConfirmado };

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    agoraOrig = wb.agora; wb.agora = () => new Date('2031-04-01T12:00:00Z');
    unicopag.criarTransacao = async () => ({ gatewayRef: `w-falso-${s}-${Date.now()}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR' });
    email.enviarWebinarConfirmado = async (para, nome, d) => { avisos.push({ para, ...d }); };
    w = (await wb.salvar({ nome: `Webinário pago ${s}`, preco: '50', maxParcelas: '3', duracaoMin: '60', publicado: '1', palavraCodigo: 'P', inicioEm: '2031-04-10T19:00', linkAoVivo: LINK })).webinario;
    outro = (await wb.salvar({ nome: `Outro pago ${s}`, preco: '40', duracaoMin: '60', publicado: '1', palavraCodigo: 'P', inicioEm: '2031-04-11T19:00' })).webinario;
    ana = await prisma.usuario.create({ data: { nome: 'Ana Compradora', email: `ana-wp-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/webinarios'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    wb.agora = agoraOrig; unicopag.criarTransacao = orig.criar; email.enviarWebinarConfirmado = orig.conf;
    await prisma.cupomEad.deleteMany({ where: { id: { in: criados } } });
    for (const x of [w, outro]) {
      const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: x.cursoId } }, select: { id: true } });
      await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
      await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
      await prisma.matricula.deleteMany({ where: { turma: { cursoId: x.cursoId } } });
    }
    await prisma.usuario.deleteMany({ where: { id: ana.id } });
    for (const x of [w, outro]) await wb.excluir(x.id);
    if (restaurarEd) await restaurarEd();
    await prisma.$disconnect();
  });

  const url = (x, resto = '') => `${site}/escola-digital/webinario/${wb.endereco(x.curso.nome)}${resto}`;
  const req = (u, usuario, opts = {}) => fetch(u, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (u, usuario, corpo = {}) => req(u, usuario, { method: 'POST', body: new URLSearchParams({ _csrf: 'x', ...corpo }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('compra: pendente sem links; pago confirmado → inscrição e e-mail; estorno → sem acesso', async () => {
    let h = await (await req(url(w), ana)).text();
    assert.match(h, /R\$\s?50,00/); assert.match(h, /até 3x/);
    const r = await post(url(w, '/comprar'), ana, { forma: 'PIX' });
    assert.equal(r.status, 302);
    const m = await prisma.matricula.findFirst({ where: { alunoId: ana.id, turma: { cursoId: w.cursoId } }, include: { pagamentos: true } });
    assert.equal(m.statusPagamento, 'PENDENTE');
    h = await (await req(url(w), ana)).text();
    assert.match(h, /Falta só confirmar o pagamento/); assert.ok(!h.includes(LINK));
    await aplicarStatus(m.pagamentos[0], { status: 'paid', payload: {} });
    assert.equal(await prisma.inscricaoWebinario.count({ where: { webinarioId: w.id, usuarioId: ana.id } }), 1);
    assert.equal(avisos.length, 1); assert.equal(avisos[0].para, ana.email);
    h = await (await req(url(w), ana)).text();
    assert.match(h, /Você está inscrito/);
    const pg = await prisma.pagamento.findFirst({ where: { matriculaId: m.id } });
    await aplicarStatus(pg, { status: 'refunded', payload: {} });
    assert.equal((await wb.acesso(ana.id, w)).situacao, 'cancelado');
    h = await (await req(url(w), ana)).text();
    assert.doesNotMatch(h, /Você está inscrito/);
  });

  test('cupom: do webinário só vale nele; geral vale; de e-book não vale', async () => {
    const mk = async (codigo, extra) => { const c = await prisma.cupomEad.create({ data: { codigo, tipo: 'PERCENTUAL', valor: 10, criadoPor: 'teste', ...extra } }); criados.push(c.id); return c; };
    await mk(`WEB${s}`, { webinarioId: w.id });
    await mk(`GER${s}`, {});
    const eb = await prisma.ebook.findFirst();
    if (eb) await mk(`EBK${s}`, { ebookId: eb.id });
    assert.ok(!(await cupons.validarCupom(`WEB${s}`, w, { webinario: true })).erro);
    assert.ok((await cupons.validarCupom(`WEB${s}`, outro, { webinario: true })).erro);
    assert.ok((await cupons.validarCupom(`WEB${s}`, eb || w, { ebook: true })).erro);
    assert.ok(!(await cupons.validarCupom(`GER${s}`, w, { webinario: true })).erro);
    if (eb) assert.ok((await cupons.validarCupom(`EBK${s}`, w, { webinario: true })).erro);
  });

  test('parcelas do cartão vêm do webinário; volta do pagamento leva à página do webinário', async () => {
    const turma = await require('../src/lib/turma-online').turmaOnline({ cursoId: w.cursoId });
    const { maxParcelasOnline } = require('../src/routes/cursos');
    if (maxParcelasOnline) assert.equal(await maxParcelasOnline(turma), 3);
    const { destinoAposPagamento } = require('../src/lib/cobranca-avista');
    const curso = await prisma.curso.findUnique({ where: { id: w.cursoId }, include: { ebook: { select: { id: true } }, webinario: { select: { id: true } } } });
    assert.equal(destinoAposPagamento({ turma: { status: 'ONLINE', curso } }), `/escola-digital/webinario/${wb.endereco(w.curso.nome)}`);
  });
});
