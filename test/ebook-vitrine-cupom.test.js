// E-books (2026-11-09): fileira na vitrine, "Minha conta → E-books", links do menu e cupons. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const { PDFDocument } = require('pdf-lib');

process.env.EBOOKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ebooks-'));
delete process.env.SUPABASE_URL;
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const V = path.join(__dirname, '..', 'src', 'views');
async function pdfCom(n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return Buffer.from(await d.save()); }

test('menus de conta: "E-books" só para quem tem (site e Escola Digital)', async () => {
  const site = fs.readFileSync(path.join(V, 'partials', 'site-header.ejs'), 'utf8');
  assert.match(site, /contaLinks\.ebooks[\s\S]{0,200}\/minha-conta\?sec=ebooks/);
  const topo = (links) => ejs.renderFile(path.join(V, 'ead-teste', '_topo.ejs'), { asset: (u) => u, titulo: 'x', base: '/b', eadModo: 'pago', usuario: { nome: 'Ana' }, contaLinks: links });
  assert.match(await topo({ ebooks: true }), /href="\/minha-conta\?sec=ebooks"/);
  assert.doesNotMatch(await topo({}), /sec=ebooks/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8'), /ebooks: e > 0/);
});

describe('vitrine, minha conta e cupom com e-book', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eb = require('../src/lib/ebook');
  const cupons = require('../src/lib/ead-cupom');
  const s = String(Date.now()).slice(-7);
  let pub; let rasc; let curso; let co; let leitor; const cupIds = [];

  before(async () => {
    pub = (await eb.salvar({ nome: `Vitrine e-book ${s}`, descricao: 'Para ler', preco: '10', publicado: '1' }, { buffer: await pdfCom(4), originalname: 'v.pdf' })).ebook;
    rasc = (await eb.salvar({ nome: `Rascunho e-book ${s}`, gratuito: '1' })).ebook;
    curso = await prisma.curso.create({ data: { nome: `Curso cupom ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 50 } });
    leitor = await prisma.usuario.create({ data: { nome: 'Leitor Conta', email: `leitor-conta-${s}@teste.local`, papel: 'ALUNO' } });
    for (const [codigo, extra] of [[`EBK${s}`, { ebookId: pub.id }], [`GER${s}`, {}], [`CUR${s}`, { cursoOnlineId: co.id }]]) {
      cupIds.push((await prisma.cupomEad.create({ data: { codigo, tipo: 'PERCENTUAL', valor: 50, criadoPor: 'teste', ...extra } })).id);
    }
  });
  after(async () => {
    await prisma.cupomEad.deleteMany({ where: { id: { in: cupIds } } });
    for (const e of [pub, rasc]) { await prisma.ebook.delete({ where: { id: e.id } }); await prisma.curso.delete({ where: { id: e.cursoId } }); }
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.usuario.delete({ where: { id: leitor.id } });
  });

  test('cupom: de e-book só no e-book; geral nos dois; de curso recusado no e-book', async () => {
    assert.equal((await cupons.validarCupom(`EBK${s}`, pub, { ebook: true })).precoFinal, 5);
    assert.ok((await cupons.validarCupom(`EBK${s}`, co)).erro);
    assert.equal((await cupons.validarCupom(`GER${s}`, pub, { ebook: true })).precoFinal, 5);
    assert.equal((await cupons.validarCupom(`GER${s}`, co)).precoFinal, 25);
    assert.equal((await cupons.validarCupom(`CUR${s}`, pub, { ebook: true })).erro, cupons.MSG.outroCurso);
  });

  test('formulário de cupom: escolher um e-book grava ebookId; lista mostra o nome', async () => {
    const r = await cupons.lerDados({ codigo: `FORM${s}`, tipo: 'PERCENTUAL', valor: '10', alvo: `ebook:${pub.id}` });
    assert.equal(r.dados.ebookId, pub.id); assert.equal(r.dados.cursoOnlineId, null);
    const r2 = await cupons.lerDados({ codigo: `FORM${s}`, tipo: 'PERCENTUAL', valor: '10', alvo: `curso:${co.id}` });
    assert.equal(r2.dados.cursoOnlineId, co.id); assert.equal(r2.dados.ebookId, null);
    const lista = await cupons.listarCupons({});
    assert.equal(lista.find((c) => c.codigo === `EBK${s}`).curso, `E-book: ${pub.curso.nome}`);
  });

  test('vitrine: fileira "E-books" só com publicado', async () => {
    const html = await ejs.renderFile(path.join(V, 'partials', 'ed-linha-ebooks.ejs'), { ebooks: await eb.daVitrine(), vitrine: require('../src/lib/vitrine') });
    assert.match(html, /E-books/);
    assert.match(html, new RegExp(`Vitrine e-book ${s}`));
    assert.match(html, /4 páginas/);
    assert.doesNotMatch(html, new RegExp(`Rascunho e-book ${s}`));
    assert.equal((await ejs.renderFile(path.join(V, 'partials', 'ed-linha-ebooks.ejs'), { ebooks: [], vitrine: require('../src/lib/vitrine') })).trim(), '');
  });

  test('minha conta: seção E-books lista o e-book com o link de baixar', async () => {
    await prisma.acessoEbook.create({ data: { ebookId: rasc.id, usuarioId: leitor.id } });
    const meus = await eb.meus(leitor.id);
    const html = await ejs.renderFile(path.join(V, 'partials', 'conta-ebooks.ejs'), { ebooks: meus, vitrine: require('../src/lib/vitrine') });
    assert.match(html, new RegExp(`Rascunho e-book ${s}`));
    assert.match(html, /\/escola-digital\/ebook\/rascunho-e-book-\d+\/baixar/);
    assert.match(fs.readFileSync(path.join(V, 'minha-conta.ejs'), 'utf8'), /sec === 'ebooks'[\s\S]{0,300}conta-ebooks/);
  });
});
