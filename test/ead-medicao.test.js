// Medição do curso online (etapa 8): Analytics/Pixel só no curso pago, eventos de início de compra e de compra
// concluída, e o JSON-LD do curso. Postgres LOCAL; a sessão vem do cabeçalho x-teste-usuario.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const M = require('../src/lib/ead-medicao');

test('jsonSeguro não deixa fechar o <script>', () => {
  const s = M.jsonSeguro({ n: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(s, /<\/script>/i);
  assert.deepEqual(JSON.parse(s), { n: '</script><script>alert(1)</script>' });
});

test('eventoInicioCompra: valor, cupom e o item', () => {
  const e = M.eventoInicioCompra({ id: 'm1', valorCurso: '44.91', turma: { cursoId: 'c1' } }, 'Curso X', 'LEI10');
  assert.equal(e.ga[0], 'begin_checkout');
  assert.deepEqual(e.ga[1], { currency: 'BRL', value: 44.91, coupon: 'LEI10', items: [{ item_id: 'c1', item_name: 'Curso X' }] });
  assert.equal(e.meta[0], 'InitiateCheckout');
  assert.deepEqual(e.meta[1], { currency: 'BRL', value: 44.91, content_ids: ['c1'], content_type: 'product' });
  assert.equal(M.eventoInicioCompra({ id: 'm1', valorCurso: 10, turma: { cursoId: 'c1' } }, 'Y', null).ga[1].coupon, undefined);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('medição nas páginas do curso online', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eadTeste = require('../src/lib/ead-teste');
  require('../src/lib/unicopag').criarTransacao = async () => ({ gatewayRef: `falso-med-${Date.now()}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR-MED' });
  const s = String(Date.now()).slice(-7);
  let server; let site; let curso; let co; let turma; let codigo; const us = {};

  const novaMatricula = (u, horas) => prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true, confirmadaEm: new Date(Date.now() - horas * 3600e3) } });

  let restaurarEd; // Escola Digital começa desligada (2026-11): liga para o teste e devolve no fim

  before(async () => { restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital(); });

  after(async () => { if (restaurarEd) await restaurarEd(); });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso </script><script>alert(1)</script> ${s}`, descricao: 'Primeiros socorros para escolas.', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9, publicado: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
    for (const n of ['Pago', 'Antigo', 'Lote', 'Pix']) us[n] = await prisma.usuario.create({ data: { nome: `${n} Medicao`, email: `${n.toLowerCase()}-med-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    us.mPago = await novaMatricula(us.Pago, 0.1);
    us.mAntigo = await novaMatricula(us.Antigo, 48);
    us.escola = await prisma.escolaEad.create({ data: { nome: `Escola Med ${s}` } });
    const lote = await prisma.loteEad.create({ data: { escolaId: us.escola.id, cursoOnlineId: co.id, vagas: 2, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'OUTRO', criadoPor: 'dev' } });
    await prisma.vagaLoteEad.create({ data: { loteId: lote.id, usuarioId: us.Lote.id, origem: 'GESTOR' } });
    codigo = await eadTeste.gerarCodigo(co.id);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = require('../src/lib/vitrine').urlCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = 'ALUNO'; }
      Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo' });
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    app.use(require('../src/routes/cursos'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const ms = await prisma.matricula.findMany({ where: { turmaId: turma.id }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((x) => x.id) } } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.vagaLoteEad.deleteMany({ where: { lote: { cursoOnlineId: co.id } } });
    await prisma.loteEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.escolaEad.delete({ where: { id: us.escola.id } });
    const acs = await prisma.alunoCursoEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true } });
    await prisma.telaVistaEad.deleteMany({ where: { alunoCursoId: { in: acs.map((x) => x.id) } } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-med-${s}@` } } });
    await eadTeste.desligar(co.id);
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const pagina = (url, u, cookie) => fetch(site + url, { redirect: 'manual', headers: { ...(u ? { 'x-teste-usuario': u.id } : {}), ...(cookie ? { cookie } : {}) } });

  test('capa do curso pago tem Analytics; o link de teste não', async () => {
    assert.match(await (await pagina(`/online/${curso.id}`)).text(), /G-HDYZZ5JZHF/);
    const teste = await (await pagina(`/ead-teste/${codigo}`)).text();
    assert.doesNotMatch(teste, /G-HDYZZ5JZHF|gtag|fbq/);
  });

  test('compra confirmada agora: purchase na 1ª página, não na 2ª (mesma sessão)', async () => {
    const r1 = await pagina(`/online/${curso.id}`, us.Pago);
    const cookie = r1.headers.get('set-cookie').split(';')[0];
    const h1 = await r1.text();
    assert.match(h1, /gtag\('event', "purchase"|gtag\('event', 'purchase'/);
    assert.ok(h1.includes(us.mPago.id), 'transaction_id = id da matrícula');
    assert.match(h1, /fbq\('track', "Purchase"|fbq\('track', 'Purchase'/);
    const h2 = await (await pagina(`/online/${curso.id}`, us.Pago, cookie)).text();
    assert.doesNotMatch(h2, /purchase/);
  });

  test('passar por /continuar (que redireciona) não gasta o evento: ele sai na página seguinte', async () => {
    const u = await prisma.usuario.create({ data: { nome: 'Cont Medicao', email: `cont-med-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    const m = await novaMatricula(u, 0.1);
    const r1 = await pagina(`/online/${curso.id}/continuar`, u);
    assert.equal(r1.status, 302);
    const cookie = r1.headers.get('set-cookie').split(';')[0];
    const destino = r1.headers.get('location');
    const h = await (await pagina(destino, u, cookie)).text();
    assert.ok(h.includes(m.id) && /"purchase"/.test(h), 'purchase na página depois do redirecionamento');
  });

  test('sem purchase para pagamento antigo e para vaga de escola', async () => {
    assert.doesNotMatch(await (await pagina(`/online/${curso.id}`, us.Antigo)).text(), /purchase/);
    assert.doesNotMatch(await (await pagina(`/online/${curso.id}`, us.Lote)).text(), /purchase/);
  });

  test('nome do curso com </script> não quebra o HTML', async () => {
    const html = await (await pagina(`/online/${curso.id}`, us.Pago)).text();
    assert.ok(!html.includes('</script><script>alert(1)'));
  });

  test('capa pública tem o JSON-LD Course com o preço', async () => {
    const html = await (await pagina(`/online/${curso.id}`)).text();
    const bloco = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(bloco, 'tem o bloco JSON-LD');
    const ld = JSON.parse(bloco[1]);
    assert.equal(ld['@type'], 'Course');
    assert.equal(ld.offers.price, 49.9);
    assert.equal(ld.offers.priceCurrency, 'BRL');
    assert.equal(ld.provider.name, 'Escola de Educação e Saúde CVB-RJ');
  });

  test('retorno do PIX do online tem begin_checkout com o valor', async () => {
    const r = await fetch(`${site}/online/${curso.id}/comprar`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ forma: 'PIX' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-teste-usuario': us.Pix.id } });
    const html = await (await pagina(r.headers.get('location'), us.Pix)).text();
    assert.match(html, /begin_checkout/);
    assert.match(html, /"value":49\.9/);
    assert.match(html, /InitiateCheckout/);
  });
});
