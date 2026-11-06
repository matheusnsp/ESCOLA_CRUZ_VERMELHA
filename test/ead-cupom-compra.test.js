// Compra do curso online com cupom (etapa 7), contra o Postgres LOCAL. Gateway e e-mail falsos; a sessão vem
// do cabeçalho x-teste-usuario (só neste app de teste), como em test/ead-online.test.js.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('/online: compra com cupom', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const unicopag = require('../src/lib/unicopag');
  const email = require('../src/lib/email');
  const C = require('../src/lib/ead-cupom');
  const gateway = [];
  const s = String(Date.now()).slice(-7);
  const cod = (x) => `C${s}-${x}`;
  let server; let base; let curso; let co; let ana; let bia; let caio; let lei10; let gratis;

  before(async () => {
    unicopag.criarTransacao = async (d) => { gateway.push(d); return { gatewayRef: `falso-${s}-${gateway.length}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: `QR-${gateway.length}` }; };
    email.enviarCursoOnlineLiberado = async () => {};
    curso = await prisma.curso.create({ data: { nome: `TESTE cupom compra ${s}`, cargaHoraria: 3, precoAvista: 300, precoCheio: 300, valorParcela: 300 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9, publicado: true, maxParcelas: 6 } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    const u = (n) => prisma.usuario.create({ data: { nome: `${n} Cupom`, email: `${n.toLowerCase()}-cp-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    ana = await u('Ana'); bia = await u('Bia'); caio = await u('Caio');
    lei10 = (await C.criarCupom({ codigo: cod('LEI10'), tipo: 'PERCENTUAL', valor: 10 }, 'dev')).cupom;
    gratis = (await C.criarCupom({ codigo: cod('GRATIS100'), tipo: 'PERCENTUAL', valor: 100 }, 'dev')).cupom;

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = 'ALUNO'; }
      res.locals.csrfToken = 'x';
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    app.use(require('../src/routes/cursos')); // tela de retorno do PIX
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/online/${curso.id}`;
  });
  after(async () => {
    server.close();
    const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: curso.id } }, select: { id: true } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ alvoId: { in: [lei10.id, gratis.id, ...ms.map((x) => x.id)] } }] } });
    await prisma.cupomEad.deleteMany({ where: { codigo: { startsWith: `C${s}-` } } });
    await prisma.matricula.deleteMany({ where: { turma: { cursoId: curso.id } } });
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-cp-${s}@` } } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const req = (url, usuario, opts = {}) => fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (url, usuario, corpo = {}) => req(url, usuario, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const { aplicarStatus } = require('../src/lib/status-pagamento');
  const novaPessoa = (n) => prisma.usuario.create({ data: { nome: `${n} Cupom`, email: `${n.toLowerCase()}-cp-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
  const matriculaDe = (u) => prisma.matricula.findFirst({ where: { alunoId: u.id, turma: { cursoId: curso.id } }, include: { pagamentos: { orderBy: { criadoEm: 'asc' } }, cupomEad: true } });

  test('capa com ?cupom: preço cheio riscado, preço final, aviso e o código no formulário; "em até 6x"', async () => {
    const html = await (await req(`${base}?cupom=${encodeURIComponent(cod('lei10').toLowerCase())}`, ana)).text();
    assert.match(html, /<s>R\$\s?49,90<\/s>/);
    assert.match(html, /R\$\s?44,91/);
    assert.match(html, new RegExp(`Cupom ${cod('LEI10')} aplicado`));
    assert.match(html, new RegExp(`name="cupom" value="${cod('LEI10')}"`));
    assert.match(html, /em até 6x no cartão/);
  });

  test('visitante que chegou pelo link: o cupom fica na sessão (criar conta e voltar); "tirar" esquece', async () => {
    const r1 = await req(`${base}?cupom=${cod('LEI10')}`, null);
    const cookie = r1.headers.get('set-cookie').split(';')[0];
    assert.match(await r1.text(), /Comprar · R\$\s?44,91/);
    const depois = await (await req(base, null, { headers: { cookie } })).text();
    assert.match(depois, new RegExp(`Cupom ${cod('LEI10')} aplicado`));
    const tirou = await (await req(`${base}?cupom=`, null, { headers: { cookie } })).text();
    assert.doesNotMatch(tirou, /aplicado/);
    assert.doesNotMatch(await (await req(base, null, { headers: { cookie } })).text(), /aplicado/);
  });

  test('capa com cupom inválido: a mensagem e o preço cheio', async () => {
    const html = await (await req(`${base}?cupom=NADA-${s}`, ana)).text();
    assert.match(html, /Cupom não encontrado\./);
    assert.match(html, /Comprar · R\$\s?49,90/);
    assert.doesNotMatch(html, /name="cupom" value=/);
  });

  test('compra PIX com cupom; depois sem cupom ⇒ registro apagado e QR NOVO com o preço cheio', async () => {
    const r = await post(`${base}/comprar`, ana, { forma: 'PIX', cupom: cod('LEI10') });
    assert.equal(r.status, 302);
    let m = await matriculaDe(ana);
    assert.equal(Number(m.valorCurso), 44.91);
    assert.equal(Number(m.cupomEad.desconto), 4.99);
    assert.equal(Number(m.cupomEad.precoFinal), 44.91);
    assert.equal(m.cupomEad.cupomId, lei10.id);
    assert.equal(gateway.at(-1).valorTotal, 44.91);
    const chamadas = gateway.length;
    await post(`${base}/comprar`, ana, { forma: 'PIX' });
    m = await matriculaDe(ana);
    assert.equal(m.cupomEad, null);
    assert.equal(Number(m.valorCurso), 49.9);
    assert.equal(gateway.length, chamadas + 1, 'o QR de 44,91 não pode ser reaproveitado');
    assert.equal(Number(m.pagamentos.at(-1).valor), 49.9);
    assert.equal(m.pagamentos.length, 2);
  });

  test('capa da matrícula pendente com cupom: "Pagar de outro jeito" mantém o cupom', async () => {
    await post(`${base}/comprar`, ana, { forma: 'PIX', cupom: cod('LEI10') });
    const html = await (await req(base, ana)).text();
    assert.match(html, new RegExp(`name="cupom" value="${cod('LEI10')}"`));
  });

  test('cupom desativado entre a capa e a compra ⇒ volta à capa com o código, nada gravado', async () => {
    const c = (await C.criarCupom({ codigo: cod('SOME'), tipo: 'VALOR', valor: 5 }, 'dev')).cupom;
    await C.ativarCupom(c.id, false, 'dev');
    const r = await post(`${base}/comprar`, bia, { forma: 'PIX', cupom: c.codigo });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `/online/${curso.id}?cupom=${encodeURIComponent(c.codigo)}`);
    assert.equal(await matriculaDe(bia), null);
  });

  test('preço mudado no painel depois da capa: o desconto é sobre o preço atual', async () => {
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { precoOnline: 100 } });
    try {
      await post(`${base}/comprar`, bia, { forma: 'CREDITO', cupom: cod('LEI10') });
      const m = await matriculaDe(bia);
      assert.equal(Number(m.valorCurso), 90);
      assert.equal(Number(m.cupomEad.precoCheio), 100);
    } finally {
      await prisma.cursoOnline.update({ where: { id: co.id }, data: { precoOnline: 49.9 } });
    }
  });

  test('cupom de 100%: capa com "Liberar curso" sem PIX/cartão; forma=CUPOM libera sem gateway', async () => {
    const html = await (await req(`${base}?cupom=${gratis.codigo}`, caio)).text();
    assert.match(html, /Liberar curso/);
    assert.match(html, /name="forma" value="CUPOM"/);
    assert.doesNotMatch(html, /value="PIX"/);
    const chamadas = gateway.length;
    const rs = await Promise.all([1, 2].map(() => post(`${base}/comprar`, caio, { forma: 'CUPOM', cupom: gratis.codigo })));
    for (const r of rs) {
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `/online/${curso.id}/continuar`);
    }
    assert.equal(gateway.length, chamadas);
    assert.equal(await prisma.matricula.count({ where: { alunoId: caio.id, turma: { cursoId: curso.id } } }), 1);
    const m = await matriculaDe(caio);
    assert.equal(m.plano, 'A_VISTA');
    assert.equal(m.statusPagamento, 'PAGO');
    assert.equal(Number(m.valorCurso), 0);
    assert.equal(m.taxaConfirmada, true);
    assert.equal(m.confirmadaPor, `cupom:${gratis.codigo}`);
    assert.equal(m.pagamentos.length, 0);
    assert.equal(Number(m.cupomEad.precoFinal), 0);
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: gratis.id, acao: 'EAD_CUPOM_LIBEROU' } }), 1);
    assert.equal((await req(`${base}/continuar`, caio)).status, 302);
    assert.equal(await C.usosDoCupom(gratis.id), 1);
  });

  test('forma=CUPOM com cupom de 10% ⇒ volta à capa, nada gravado', async () => {
    const dani = await prisma.usuario.create({ data: { nome: 'Dani Cupom', email: `dani-cp-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    try {
      const r = await post(`${base}/comprar`, dani, { forma: 'CUPOM', cupom: cod('LEI10') });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `/online/${curso.id}?cupom=${encodeURIComponent(cod('LEI10'))}`);
      assert.equal(await matriculaDe(dani), null);
    } finally {
      await prisma.usuario.delete({ where: { id: dani.id } });
    }
  });

  test('[revisão C1] sem cupom → com cupom → sem cupom: a tela do PIX mostra o QR de R$ 49,90', async () => {
    const eva = await novaPessoa('Eva');
    await post(`${base}/comprar`, eva, { forma: 'PIX' });
    await post(`${base}/comprar`, eva, { forma: 'PIX', cupom: cod('LEI10') });
    const r = await post(`${base}/comprar`, eva, { forma: 'PIX' });
    const m = await matriculaDe(eva);
    assert.equal(Number(m.valorCurso), 49.9);
    const qrCheio = m.pagamentos.find((p) => Number(p.valor) === 49.9).pixQrCode;
    const qrDesconto = m.pagamentos.find((p) => Number(p.valor) === 44.91).pixQrCode;
    const html = await (await req(new URL(r.headers.get('location'), base).href, eva)).text();
    assert.ok(html.includes(qrCheio), 'mostra o QR do valor da matrícula');
    assert.ok(!html.includes(qrDesconto));
  });

  test('[revisão C1] pagou um QR de outro valor: a matrícula fica com o valor pago e o cupom acompanha', async () => {
    const eva = await prisma.usuario.findFirst({ where: { email: `eva-cp-${s}@teste.local` } });
    let m = await matriculaDe(eva); // 49,90 sem cupom, mas o QR de 44,91 (com cupom) continua pagável
    await aplicarStatus(m.pagamentos.find((p) => Number(p.valor) === 44.91), { status: 'paid', payload: {} });
    m = await matriculaDe(eva);
    assert.equal(m.statusPagamento, 'PAGO');
    assert.equal(Number(m.valorCurso), 44.91);

    const fabi = await novaPessoa('Fabi');
    await post(`${base}/comprar`, fabi, { forma: 'PIX' }); // QR de 49,90
    await post(`${base}/comprar`, fabi, { forma: 'PIX', cupom: cod('LEI10') }); // agora 44,91 com cupom
    m = await matriculaDe(fabi);
    await aplicarStatus(m.pagamentos.find((p) => Number(p.valor) === 49.9), { status: 'paid', payload: {} });
    m = await matriculaDe(fabi);
    assert.equal(Number(m.valorCurso), 49.9);
    assert.equal(m.cupomEad, null, 'pagou o preço cheio: o cupom não foi usado');
  });

  test('[revisão C1] "Liberar curso" cancela as cobranças pendentes da matrícula', async () => {
    const gabi = await novaPessoa('Gabi');
    await post(`${base}/comprar`, gabi, { forma: 'PIX' });
    await post(`${base}/comprar`, gabi, { forma: 'CUPOM', cupom: gratis.codigo });
    const m = await matriculaDe(gabi);
    assert.equal(m.statusPagamento, 'PAGO');
    assert.deepEqual(m.pagamentos.map((p) => p.status), ['CANCELADO']);
  });

  // Por último: esgota o limite de tentativas deste IP.
  test('[revisão I3] tentativas de cupom têm limite: depois de 30, a capa avisa e a compra não usa o cupom', async () => {
    let html = '';
    for (let i = 0; i < 31; i++) html = await (await req(`${base}?cupom=CHUTE${i}`, null)).text();
    assert.match(html, /Muitas tentativas de cupom\. Espere alguns minutos e tente de novo\./);
    assert.doesNotMatch(html, /Cupom não encontrado/);
    const hugo = await novaPessoa('Hugo');
    const r = await post(`${base}/comprar`, hugo, { forma: 'CUPOM', cupom: gratis.codigo });
    assert.equal(r.status, 302);
    assert.equal(await matriculaDe(hugo), null);
  });
});
