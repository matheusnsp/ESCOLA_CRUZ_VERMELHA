// Parcelamento do curso online no cartão (etapa 7), contra o Postgres LOCAL. O Únicopag é falso: a transação e
// a tabela de juros (10% sobre o valor, qualquer número de parcelas).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const unicopag = require('../src/lib/unicopag');
const gateway = [];
const consultas = [];
unicopag.criarTransacao = async (d) => { gateway.push(d); return { gatewayRef: `falso-parc-${Date.now()}-${gateway.length}`, hash: 'h', paymentStatus: 'processing', pixQrCode: 'QR' }; };
const tabelaFalsa = async (centavos, n) => { consultas.push([centavos, n]); return { installments: n, installment_rate: 10, installment_amount: Math.round((centavos * 1.1) / n), total_amount: Math.round(centavos * 1.1) }; };
unicopag.obterOpcaoParcelamento = tabelaFalsa;
// A tela do cartão consulta a tabela inteira uma vez (revisão I4).
const tabelasConsultadas = [];
const tabelaInteira = async (centavos) => { tabelasConsultadas.push(centavos); return Promise.all(Array.from({ length: 12 }, (_, i) => tabelaFalsa(centavos, i + 1))); };
unicopag.consultarParcelamento = tabelaInteira;

const { opcoesParcelasOnline, cobrancaCartaoOnline } = require('../src/lib/cobranca-avista');

test('opcoesParcelasOnline: uma consulta só da tabela; 1x sempre, sem juros; falha ⇒ só 1x; max 1 ⇒ sem consulta', async () => {
  const antes = tabelasConsultadas.length;
  const ops = await opcoesParcelasOnline(100.01, 6, tabelaInteira);
  assert.equal(tabelasConsultadas.length, antes + 1, 'uma consulta para as 6 opções');
  assert.deepEqual(ops.map((o) => o.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ops[0], { n: 1, valorParcela: 100.01, total: 100.01 });
  assert.equal(ops[2].total, 110.01);
  await opcoesParcelasOnline(100.01, 6, tabelaInteira);
  assert.equal(tabelasConsultadas.length, antes + 1, 'a mesma tabela fica guardada');
  assert.deepEqual((await opcoesParcelasOnline(100.02, 3, async () => null)).map((o) => o.n), [1]);
  const semN3 = async (c) => (await tabelaInteira(c)).filter((o) => o.installments !== 3);
  assert.deepEqual((await opcoesParcelasOnline(100.04, 4, semN3)).map((o) => o.n), [1, 2, 4]);
  const n = tabelasConsultadas.length;
  assert.deepEqual((await opcoesParcelasOnline(100.03, 1, tabelaInteira)).map((o) => o.n), [1]);
  assert.equal(tabelasConsultadas.length, n);
});

test('consultarParcelamento tem limite de tempo (a tela do cartão não trava com o Únicopag lento)', async () => {
  const nf = require.resolve('node-fetch');
  const fetchOriginal = require.cache[nf]; const tokenOriginal = process.env.UNICOPAG_API_TOKEN;
  let sinal = null;
  require.cache[nf] = { id: nf, filename: nf, loaded: true, exports: async (url, opts) => { sinal = opts && opts.signal; return { ok: true, json: async () => ({ data: [] }) }; } };
  process.env.UNICOPAG_API_TOKEN = 'token-falso';
  try {
    delete require.cache[require.resolve('../src/lib/unicopag')];
    const real = require('../src/lib/unicopag');
    await real.consultarParcelamento(1000);
    assert.ok(sinal, 'fetch recebe um AbortSignal');
  } finally {
    if (fetchOriginal) require.cache[nf] = fetchOriginal; else delete require.cache[nf];
    if (tokenOriginal === undefined) delete process.env.UNICOPAG_API_TOKEN; else process.env.UNICOPAG_API_TOKEN = tokenOriginal;
    delete require.cache[require.resolve('../src/lib/unicopag')];
    require.cache[require.resolve('../src/lib/unicopag')] = { id: require.resolve('../src/lib/unicopag'), filename: require.resolve('../src/lib/unicopag'), loaded: true, exports: unicopag };
  }
});

test('cobrancaCartaoOnline: valor base é o da matrícula; com a opção, total e parcela com juros', () => {
  assert.deepEqual(cobrancaCartaoOnline({ valorCurso: 50 }), { valorCobranca: 50, valorBase: 50, numParcelas: 1, valorParcela: null, tipo: 'CURSO' });
  const c = cobrancaCartaoOnline({ valorCurso: 50 }, 3, { installment_amount: 1833, total_amount: 5500 });
  assert.deepEqual(c, { valorCobranca: 55, valorBase: 50, numParcelas: 3, valorParcela: 18.33, tipo: 'CURSO' });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('cartão parcelado do curso online', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const email = require('../src/lib/email');
  const { aplicarStatus } = require('../src/lib/status-pagamento');
  const { acessoPago } = require('../src/lib/ead-acesso');
  const s = String(Date.now()).slice(-7);
  let server; let site; let painel; let curso; let co; let ana; let bia; const auditoria = [];
  const cartao = { numero: '4111111111111111', titular: 'ANA TESTE', validade: '12/30', cvv: '123', etapa: 'curso' };

  let restaurarEd; // Escola Digital começa desligada (2026-11): liga para o teste e devolve no fim

  before(async () => { restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital(); });

  after(async () => { if (restaurarEd) await restaurarEd(); });

  before(async () => {
    email.enviarCursoOnlineLiberado = async () => {};
    email.enviarMatriculaConfirmada = async () => {};
    curso = await prisma.curso.create({ data: { nome: `TESTE parcelas ${s}`, cargaHoraria: 3, precoAvista: 300, precoCheio: 300, valorParcela: 300 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 120, publicado: true, maxParcelas: 6 } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    ana = await prisma.usuario.create({ data: { nome: 'Ana Parc', email: `ana-parc-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Parc', email: `bia-parc-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = 'ALUNO'; }
      res.locals.csrfToken = 'x';
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/cursos'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;

    const adm = express();
    adm.set('view engine', 'ejs');
    adm.set('views', path.join(__dirname, '..', 'src', 'views'));
    adm.locals.asset = require('../src/lib/assets').asset;
    adm.use(express.urlencoded({ extended: true }));
    adm.use((req, res, next) => { Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV' } }); next(); });
    adm.use(require('../src/routes/ead')({ requireDev: (req, res, next) => next(), auditar: async (req, acao, alvo, id, dados) => { auditoria.push({ acao, dados }); }, ADMIN_URL: '' }));
    await new Promise((r) => { painel = adm.listen(0, r); });
  });
  after(async () => {
    server.close(); painel.close();
    const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: curso.id } }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
    await prisma.matricula.deleteMany({ where: { turma: { cursoId: curso.id } } });
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const req = (url, usuario, opts = {}) => fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (url, usuario, corpo = {}) => req(url, usuario, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const matriculaDe = (u) => prisma.matricula.findFirst({ where: { alunoId: u.id, turma: { cursoId: curso.id } }, include: { pagamentos: { orderBy: { criadoEm: 'asc' } } } });
  const comprarCartao = async (u) => { await post(`${site}/online/${curso.id}/comprar`, u, { forma: 'CREDITO' }); return matriculaDe(u); };
  const cartaoPost = (u, m, parcelas) => post(`${site}/inscricao/cartao/${m.id}`, u, { ...cartao, parcelas: String(parcelas) });

  test('tela do cartão: seletor com as opções de 1x a 6x', async () => {
    const m = await comprarCartao(ana);
    const html = await (await req(`${site}/inscricao/retorno?matriculaId=${m.id}&pix=0&etapa=curso`, ana)).text();
    assert.match(html, /id="ccParcelas"/);
    assert.equal((html.match(/<option value="\d+"/g) || []).length, 6);
    assert.match(html, /3x de R\$\s?44,00/);
  });

  test('parcelas fora de 1..6 ⇒ 400, sem gateway', async () => {
    const m = await matriculaDe(ana);
    const antes = gateway.length;
    for (const p of [7, 0]) {
      const r = await cartaoPost(ana, m, p);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).mensagem, 'Escolha de 1 a 6 parcelas.');
    }
    assert.equal(gateway.length, antes);
  });

  test('3x: plano PARCELADO, gateway recebe o valor base e 3 parcelas, sem a trava da taxa', async () => {
    const m = await matriculaDe(ana);
    assert.equal(m.taxaConfirmada, false);
    const r = await cartaoPost(ana, m, 3);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).ok, true);
    const g = gateway.at(-1);
    assert.equal(g.valorTotal, 120);
    assert.equal(g.dadosCartao.parcelas, 3);
    const d = await matriculaDe(ana);
    assert.equal(d.plano, 'PARCELADO');
    assert.equal(Number(d.pagamentos.at(-1).valor), 120);
  });

  test('confirmação do parcelado: PARCELADO, taxa confirmada, valor com juros e acesso liberado', async () => {
    const m = await matriculaDe(ana);
    await aplicarStatus(m.pagamentos.at(-1), { status: 'paid', payload: { amount_total: 13200 } });
    const d = await matriculaDe(ana);
    assert.equal(d.statusPagamento, 'PARCELADO');
    assert.equal(d.taxaConfirmada, true);
    assert.equal(Number(d.valorCurso), 132);
    assert.equal((await acessoPago(ana.id, co)).liberado, true);
  });

  test('1x no cartão ⇒ plano A_VISTA; tentativa 3x seguida de PIX ⇒ A_VISTA e PAGO', async () => {
    let m = await comprarCartao(bia);
    await prisma.pagamento.updateMany({ where: { matriculaId: m.id }, data: { status: 'CANCELADO' } });
    await cartaoPost(bia, m, 3);
    assert.equal((await matriculaDe(bia)).plano, 'PARCELADO');
    await prisma.pagamento.updateMany({ where: { matriculaId: m.id }, data: { status: 'CANCELADO' } }); // recusado
    await cartaoPost(bia, m, 1);
    assert.equal((await matriculaDe(bia)).plano, 'A_VISTA');
    await prisma.pagamento.updateMany({ where: { matriculaId: m.id }, data: { status: 'CANCELADO' } });
    await cartaoPost(bia, m, 3);
    await prisma.pagamento.updateMany({ where: { matriculaId: m.id }, data: { status: 'CANCELADO' } });
    await post(`${site}/online/${curso.id}/comprar`, bia, { forma: 'PIX' });
    m = await matriculaDe(bia);
    assert.equal(m.plano, 'A_VISTA');
    await aplicarStatus(m.pagamentos.at(-1), { status: 'paid', payload: {} });
    const d = await matriculaDe(bia);
    assert.equal(d.statusPagamento, 'PAGO');
    assert.equal(Number(d.valorCurso), 120);
  });

  test('[revisão I2] PIX gerado, tentativa 3x recusada, PIX pago ⇒ PAGO, A_VISTA, forma PIX', async () => {
    const duda = await prisma.usuario.create({ data: { nome: 'Duda Parc', email: `duda-parc-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    try {
      await post(`${site}/online/${curso.id}/comprar`, duda, { forma: 'PIX' });
      let m = await matriculaDe(duda);
      const pix = m.pagamentos.at(-1);
      assert.equal(pix.metodo, 'PIX');
      await prisma.pagamento.update({ where: { id: pix.id }, data: { criadoEm: new Date(Date.now() - 5 * 60e3) } }); // fora da trava de 3 min
      await cartaoPost(duda, m, 3);
      assert.equal((await matriculaDe(duda)).plano, 'PARCELADO');
      await prisma.pagamento.updateMany({ where: { matriculaId: m.id, metodo: 'CREDITO' }, data: { status: 'CANCELADO' } }); // recusado
      await aplicarStatus(await prisma.pagamento.findUnique({ where: { id: pix.id } }), { status: 'paid', payload: {} });
      m = await matriculaDe(duda);
      assert.equal(m.statusPagamento, 'PAGO');
      assert.equal(m.plano, 'A_VISTA');
      assert.equal(m.forma, 'PIX');
      assert.equal(Number(m.valorCurso), 120);
    } finally {
      const ms = await prisma.matricula.findMany({ where: { alunoId: duda.id }, select: { id: true } });
      await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
      await prisma.matricula.deleteMany({ where: { alunoId: duda.id } });
      await prisma.usuario.delete({ where: { id: duda.id } });
    }
  });

  test('com maxParcelas 1: tela sem seletor e só 1x aceito', async () => {
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { maxParcelas: 1 } });
    try {
      const cara = await prisma.usuario.create({ data: { nome: 'Cara Parc', email: `cara-parc-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
      const m = await comprarCartao(cara);
      const html = await (await req(`${site}/inscricao/retorno?matriculaId=${m.id}&pix=0&etapa=curso`, cara)).text();
      assert.doesNotMatch(html, /id="ccParcelas"/);
      assert.equal((await cartaoPost(cara, m, 2)).status, 400);
      await prisma.pagamento.deleteMany({ where: { matriculaId: m.id } });
      await prisma.matricula.delete({ where: { id: m.id } });
      await prisma.usuario.delete({ where: { id: cara.id } });
    } finally {
      await prisma.cursoOnline.update({ where: { id: co.id }, data: { maxParcelas: 6 } });
    }
  });

  test('painel: parcelas de 1 a 12, salvo e auditado', async () => {
    const url = `http://127.0.0.1:${painel.address().port}/ead/curso/${co.id}/parcelas`;
    const p = (v) => fetch(url, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ maxParcelas: v }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const r = await p('13');
    assert.match(decodeURIComponent(r.headers.get('location')), /erro=Parcelas: de 1 a 12\./);
    assert.equal((await prisma.cursoOnline.findUnique({ where: { id: co.id } })).maxParcelas, 6);
    const ok = await p('4');
    assert.match(ok.headers.get('location'), /ok=/);
    assert.equal((await prisma.cursoOnline.findUnique({ where: { id: co.id } })).maxParcelas, 4);
    assert.deepEqual(auditoria.at(-1), { acao: 'EAD_PARCELAS', dados: { de: 6, para: 4 } });
    const html = await (await fetch(`http://127.0.0.1:${painel.address().port}/ead/curso/${co.id}`)).text();
    assert.match(html, /name="maxParcelas"[^>]*value="4"/);
  });
});
