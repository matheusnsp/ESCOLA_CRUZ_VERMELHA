// E-books (2026-11-09): painel Escola Digital → E-books (src/routes/ead-ebooks.js). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { PDFDocument } = require('pdf-lib');
const { clienteFalso } = require('./helpers/ia-falso');
const { ouvir } = require('./helpers/painel-ead');

process.env.EBOOKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ebooks-'));
delete process.env.SUPABASE_URL;
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
async function pdfCom(n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return Buffer.from(await d.save()); }

describe('painel de e-books', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const txt = require('../src/lib/ia-textos');
  const s = String(Date.now()).slice(-7);
  const auditados = [];
  let srv; let pedidoClaude = null; const amb = process.env.ANTHROPIC_API_KEY;

  const form = (campos, pdf) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ _csrf: 'x', ...campos })) f.append(k, v);
    if (pdf) f.append('pdf', new Blob([pdf.buf], { type: pdf.tipo || 'application/pdf' }), pdf.nome || 'livro.pdf');
    return f;
  };
  const enviar = (u, campos, pdf) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', body: form(campos, pdf) });
  const post = (u, dados = {}) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', ...dados }) });
  const get = async (u) => (await fetch(srv.url + u)).text();
  const meus = () => prisma.ebook.findMany({ where: { curso: { nome: { contains: s } } }, include: { curso: true } });

  before(async () => {
    process.env.ANTHROPIC_API_KEY = amb || 'sk-ant-teste';
    txt.definirCliente(clienteFalso([(params) => { pedidoClaude = params; return { descricao: 'Curta da IA.', descricaoLonga: 'Longa da IA.', faqs: [{ pergunta: 'P1?', resposta: 'R1.' }] }; }]));
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: 'dev-ebook' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: 'dev-ebook' }, modo: 'online' }); next(); });
    app.use(require('../src/routes/ead-ebooks')({ requireDev: (req, res, next) => next(), auditar: async (req, acao, tipo, id, det) => { auditados.push(acao); }, ADMIN_URL: '' }));
    srv = await ouvir(app);
  });
  after(async () => {
    srv.server.close();
    txt.definirCliente(null);
    if (amb === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = amb;
    for (const e of await meus()) {
      await prisma.ebook.delete({ where: { id: e.id } });
      await prisma.faqCurso.deleteMany({ where: { cursoId: e.cursoId } });
      await prisma.curso.delete({ where: { id: e.cursoId } });
    }
  });

  test('criar com PDF: aparece na lista com páginas; auditado', async () => {
    const r = await enviar('/ead/ebooks/novo', { nome: `Guia do kit ${s}`, descricao: 'Curto', descricaoLonga: 'Longo', preco: '19,90', maxParcelas: '3', 'faqsIa[0][usar]': '1', 'faqsIa[0][pergunta]': 'Para quem?', 'faqsIa[0][resposta]': 'Para todos.' }, { buf: await pdfCom(3), nome: 'guia.pdf' });
    assert.equal(r.status, 302);
    const [e] = await meus();
    assert.equal(e.paginas, 3);
    assert.equal(Number(e.precoOnline), 19.9);
    assert.equal(await prisma.faqCurso.count({ where: { cursoId: e.cursoId } }), 1, 'dúvida marcada da IA gravada');
    assert.ok(auditados.includes('CRIOU_EBOOK'));
    const lista = await get('/ead/ebooks');
    assert.match(lista, new RegExp(`Guia do kit ${s}`));
    assert.match(lista, /3 páginas/);
    assert.match(lista, /R\$\s19,90/);
  });

  test('erros na tela: arquivo que não é PDF; publicar sem PDF', async () => {
    const a = await enviar('/ead/ebooks/novo', { nome: `Não PDF ${s}`, gratuito: '1' }, { buf: Buffer.from('oi'), nome: 'x.pdf' });
    assert.equal(a.status, 400);
    assert.match(await a.text(), /Este arquivo não é um PDF válido/);
    const b = await enviar('/ead/ebooks/novo', { nome: `Sem PDF ${s}`, gratuito: '1', publicado: '1' });
    assert.equal(b.status, 400);
    assert.match(await b.text(), /Envie o PDF do e-book antes de publicar/);
  });

  test('editar, trocar o PDF, dúvidas e excluir', async () => {
    const [e] = await meus();
    const r = await enviar(`/ead/ebooks/${e.id}`, { nome: e.curso.nome, preco: '25', publicado: '1' }, { buf: await pdfCom(5), nome: 'novo.pdf' });
    assert.equal(r.status, 302);
    const depois = await prisma.ebook.findUnique({ where: { id: e.id } });
    assert.equal(depois.paginas, 5); assert.equal(depois.publicado, true);
    assert.ok(auditados.includes('TROCOU_PDF_EBOOK'));
    assert.match(await get(`/ead/ebooks/${e.id}`), /novo\.pdf/);
    await post(`/ead/ebooks/${e.id}/faqs`, { pergunta: 'Tem certificado?', resposta: 'Não, é um e-book.' });
    const f = await prisma.faqCurso.findFirst({ where: { cursoId: e.cursoId, pergunta: 'Tem certificado?' } });
    assert.ok(f);
    await post(`/ead/ebooks/${e.id}/faqs/${f.id}/remover`);
    assert.equal(await prisma.faqCurso.count({ where: { id: f.id } }), 0);
  });

  test('Escrever com IA: manda as primeiras páginas do PDF como documento e devolve os textos', async () => {
    const [e] = await meus();
    const j = await (await post('/ead/ebooks/ia-textos', { ebookId: e.id, nome: e.curso.nome, ideias: 'para pais' })).json();
    assert.equal(j.ok, true, j.erro);
    assert.equal(j.textos.descricaoLonga, 'Longa da IA.');
    const blocos = pedidoClaude.messages[0].content;
    assert.ok(blocos.some((b) => b.type === 'document' && b.source.media_type === 'application/pdf'));
  });

  test('excluir sem compras apaga; o formulário novo abre', async () => {
    const r = await enviar('/ead/ebooks/novo', { nome: `Apagar ${s}`, gratuito: '1' });
    assert.equal(r.status, 302);
    const e = (await meus()).find((x) => x.curso.nome === `Apagar ${s}`);
    assert.equal((await post(`/ead/ebooks/${e.id}/excluir`)).status, 302);
    assert.equal(await prisma.ebook.count({ where: { id: e.id } }), 0);
    assert.match(await get('/ead/ebooks/novo'), /Novo e-book/);
  });
});
