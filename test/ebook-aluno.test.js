// E-books (2026-11-09): página, compra e download (src/routes/ebooks.js). Postgres LOCAL; gateway e e-mail falsos;
// a sessão vem do cabeçalho x-teste-usuario (só neste app de teste).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const session = require('express-session');
const { PDFDocument } = require('pdf-lib');

process.env.EBOOKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ebooks-'));
delete process.env.SUPABASE_URL;
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
async function pdfCom(n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return Buffer.from(await d.save()); }
const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); } return d.join(''); };
function conteudo(buf) { const s = buf.toString('latin1'); let out = s; const re = /stream\r?\n([\s\S]*?)endstream/g; let m; while ((m = re.exec(s))) { try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) { /* */ } } return out; }

describe('e-book: página, compra e download', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eb = require('../src/lib/ebook');
  const unicopag = require('../src/lib/unicopag');
  const email = require('../src/lib/email');
  const { aplicarStatus } = require('../src/lib/status-pagamento');
  const s = String(Date.now()).slice(-7);
  const gateway = []; const avisos = []; let server; let site; let gratis; let pago; let ana; let bia; let restaurarEd;
  const orig = { criar: unicopag.criarTransacao, aviso: email.enviarEbookLiberado };

  before(async () => {
    restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital();
    unicopag.criarTransacao = async (d) => { gateway.push(d); return { gatewayRef: `eb-falso-${s}-${gateway.length}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR-FALSO' }; };
    email.enviarEbookLiberado = async (para, nome, dados) => { avisos.push({ para, nome, ...dados }); };
    gratis = (await eb.salvar({ nome: `Guia grátis ${s}`, descricao: 'Curto grátis', descricaoLonga: 'Sobre o grátis', gratuito: '1', publicado: '1' }, { buffer: await pdfCom(2), originalname: 'g.pdf' })).ebook;
    pago = (await eb.salvar({ nome: `Guia pago ${s}`, descricao: 'Curto pago', preco: '29,90', publicado: '1' }, { buffer: await pdfCom(3), originalname: 'p.pdf' })).ebook;
    ana = await prisma.usuario.create({ data: { nome: 'Ana Leitora', email: `ana-eb-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Leitora', email: `bia-eb-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/ebooks'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    unicopag.criarTransacao = orig.criar; email.enviarEbookLiberado = orig.aviso;
    for (const e of [gratis, pago]) {
      const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: e.cursoId } }, select: { id: true } });
      await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
      await prisma.matricula.deleteMany({ where: { turma: { cursoId: e.cursoId } } });
      await prisma.turma.deleteMany({ where: { cursoId: e.cursoId } });
      await prisma.ebook.delete({ where: { id: e.id } });
      await prisma.curso.delete({ where: { id: e.cursoId } });
    }
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    if (restaurarEd) await restaurarEd();
  });

  const url = (e, resto = '') => `${site}/escola-digital/ebook/${eb.endereco(e.curso.nome)}${resto}`;
  const req = (u, usuario, opts = {}) => fetch(u, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (u, usuario, corpo = {}) => req(u, usuario, { method: 'POST', body: new URLSearchParams({ _csrf: 'x', ...corpo }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('página: botões conforme a situação; capa, páginas e sobre', async () => {
    const semLogin = await (await req(url(gratis))).text();
    assert.match(semLogin, /Criar conta e baixar/);
    assert.match(semLogin, /2 páginas/);
    assert.match(semLogin, /Sobre o grátis/);
    assert.match(await (await req(url(gratis), ana)).text(), /href="[^"]*\/baixar"[^>]*>\s*Baixar e-book/);
    const pagoSem = await (await req(url(pago))).text();
    assert.match(pagoSem, /Criar conta e comprar/);
    assert.match(pagoSem, /R\$\s29,90/);
    assert.match(await (await req(url(pago), ana)).text(), /Comprar · R\$\s29,90/);
    assert.equal((await req(`${site}/escola-digital/ebook/nao-existe-${s}`)).status, 404);
  });

  test('download: sem login pede login; grátis baixa com o rodapé e conta o download', async () => {
    const r1 = await req(url(gratis, '/baixar'));
    assert.equal(r1.status, 302); assert.match(r1.headers.get('location'), /\/login/);
    const r2 = await req(url(gratis, '/baixar'), ana);
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('content-type'), 'application/pdf');
    assert.match(r2.headers.get('content-disposition'), /attachment; filename="guia-gratis-/);
    const buf = Buffer.from(await r2.arrayBuffer());
    assert.equal((await PDFDocument.load(buf)).getPageCount(), 2);
    const hex = Buffer.from('Licenciado para Ana Leitora', 'latin1').toString('hex').toUpperCase();
    assert.ok(conteudo(buf).toUpperCase().includes(hex), 'rodapé com o nome');
    assert.equal(await prisma.downloadEbook.count({ where: { ebookId: gratis.id, usuarioId: ana.id } }), 1);
    assert.equal(await prisma.acessoEbook.count({ where: { ebookId: gratis.id, usuarioId: ana.id } }), 1);
  });

  test('pago: sem compra o download volta para a página; PIX ⇒ cobrança; pago ⇒ baixa e recebe e-mail', async () => {
    const r1 = await req(url(pago, '/baixar'), bia);
    assert.equal(r1.status, 302); assert.equal(new URL(r1.headers.get('location'), site).pathname, new URL(url(pago)).pathname);
    const r2 = await post(url(pago, '/comprar'), bia, { forma: 'PIX' });
    assert.equal(r2.status, 302);
    assert.equal(gateway.length, 1);
    const m = await prisma.matricula.findFirst({ where: { alunoId: bia.id, turma: { cursoId: pago.cursoId } }, include: { pagamentos: true } });
    assert.equal(Number(m.valorCurso), 29.9);
    assert.match(await (await req(url(pago), bia)).text(), /Ver o pagamento|Pagamento em andamento/);
    await aplicarStatus(m.pagamentos[0], { status: 'paid', payload: {} });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(avisos.length, 1);
    assert.match(avisos[0].link, new RegExp(`/escola-digital/ebook/${eb.endereco(pago.curso.nome)}$`));
    const r3 = await req(url(pago, '/baixar'), bia);
    assert.equal(r3.status, 200);
    assert.match(await (await req(url(pago), bia)).text(), /Já é seu desde/);
  });

  test('[revisão I1] despublicado: quem comprou continua vendo e baixando; visitante não', async () => {
    await prisma.ebook.update({ where: { id: pago.id }, data: { publicado: false } });
    try {
      assert.equal((await req(url(pago), bia)).status, 200);
      assert.equal((await req(url(pago, '/baixar'), bia)).status, 200);
      assert.equal((await req(url(pago))).status, 404);
      assert.equal((await req(url(pago), ana)).status, 404);
    } finally { await prisma.ebook.update({ where: { id: pago.id }, data: { publicado: true } }); }
  });

  test('[revisão I2] cartão do e-book usa as parcelas do e-book', async () => {
    await prisma.ebook.update({ where: { id: pago.id }, data: { maxParcelas: 4 } });
    const turma = await prisma.turma.findFirst({ where: { cursoId: pago.cursoId, status: 'ONLINE' } });
    assert.equal(await require('../src/routes/cursos').maxParcelasOnline(turma), 4);
  });

  test('[revisão I4] e-book pago não conta como inscrição em andamento (não trava excluir a conta)', async () => {
    assert.equal(await require('../src/lib/excluir-conta').contarEmAndamento(bia.id), 0);
  });

  test('[revisão I3] limite de downloads conferido antes de preparar o PDF', async () => {
    await prisma.downloadEbook.createMany({ data: Array.from({ length: 20 }, () => ({ ebookId: gratis.id, usuarioId: ana.id })) });
    await prisma.ebook.update({ where: { id: gratis.id }, data: { arquivoPdf: 'local:sumiu-tambem.pdf' } });
    const r = await req(url(gratis, '/baixar'), ana);
    assert.equal(r.status, 302, 'acima do limite volta para a página (sem ler nem montar o PDF)');
    assert.match(r.headers.get('location'), /erro=limite/);
    await prisma.downloadEbook.deleteMany({ where: { ebookId: gratis.id, usuarioId: ana.id } });
  });

  test('arquivo sumido: página de erro amigável (503), sem contar download', async () => {
    const antes = await prisma.downloadEbook.count({ where: { usuarioId: ana.id } });
    await prisma.ebook.update({ where: { id: gratis.id }, data: { arquivoPdf: 'local:sumiu.pdf' } });
    const r = await req(url(gratis, '/baixar'), ana);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /Não conseguimos preparar o seu e-book agora/);
    assert.equal(await prisma.downloadEbook.count({ where: { usuarioId: ana.id } }), antes);
  });
});
