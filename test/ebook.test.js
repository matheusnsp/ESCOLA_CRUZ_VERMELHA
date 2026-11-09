// E-books (2026-11-09): regras (src/lib/ebook.js). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

process.env.EBOOKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ebooks-'));
delete process.env.SUPABASE_URL;

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
async function pdfCom(n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return Buffer.from(await d.save()); }

describe('regras do e-book', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eb = require('../src/lib/ebook');
  const { turmaOnline } = require('../src/lib/turma-online');
  const s = String(Date.now()).slice(-7);
  const criados = []; const usuarios = [];
  const usuario = async (n) => { const u = await prisma.usuario.create({ data: { nome: 'Leitor ' + n, email: `leitor${n}${s}@teste.local`, senhaHash: 'x', cpfCnpj: String(10000000000 + Number(s) * 10 + n).slice(0, 11) } }); usuarios.push(u.id); return u; };
  const novo = async (dados, arquivo) => { const r = await eb.salvar({ nome: `E-book ${s} ${criados.length}`, descricao: 'Curto', descricaoLonga: 'Longo', preco: '0', gratuito: '1', ...dados }, arquivo); if (r.ebook) criados.push(r.ebook); return r; };

  after(async () => {
    for (const e of criados) {
      const ids = (await prisma.turma.findMany({ where: { cursoId: e.cursoId }, select: { id: true } })).map((t) => t.id);
      await prisma.pagamento.deleteMany({ where: { matricula: { turmaId: { in: ids } } } });
      await prisma.matricula.deleteMany({ where: { turmaId: { in: ids } } });
      await prisma.turma.deleteMany({ where: { id: { in: ids } } });
      await prisma.ebook.deleteMany({ where: { id: e.id } });
      await prisma.faqCurso.deleteMany({ where: { cursoId: e.cursoId } });
      await prisma.curso.deleteMany({ where: { id: e.cursoId } });
    }
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  });

  test('salvar: cria o curso escondido (ativo false) e guarda páginas e tamanho do PDF', async () => {
    const r = await novo({}, { buffer: await pdfCom(3), originalname: 'livro.pdf' });
    assert.ok(r.ebook, r.erro);
    const curso = await prisma.curso.findUnique({ where: { id: r.ebook.cursoId } });
    assert.equal(curso.ativo, false);
    assert.equal(r.ebook.paginas, 3);
    assert.ok(r.ebook.tamanhoBytes > 0);
    assert.match(r.ebook.arquivoPdf, /^local:/);
    assert.equal(r.ebook.arquivoNome, 'livro.pdf');
  });

  test('salvar: recusa não-PDF, PDF grande demais, nome repetido e publicar sem PDF', async () => {
    assert.equal((await novo({}, { buffer: Buffer.from('oi'), originalname: 'x.pdf' })).erro, 'Este arquivo não é um PDF válido.');
    assert.match((await novo({ publicado: '1' })).erro, /Envie o PDF/);
    const a = await novo({ nome: `Repetido ${s}` });
    assert.ok(a.ebook);
    assert.match((await eb.salvar({ nome: `REPETIDO ${s}`, preco: '0', gratuito: '1' })).erro, /Já existe um e-book com este nome/);
    assert.match((await eb.salvar({ nome: '' })).erro, /Escreva o título/);
    assert.match((await eb.salvar({ nome: `Pago sem preço ${s}`, preco: '0' })).erro, /preço/);
  });

  test('acesso: sem conta, grátis, pago sem compra, pendente e pago', async () => {
    const gratis = (await novo({ publicado: '1' }, { buffer: await pdfCom(1), originalname: 'g.pdf' })).ebook;
    const pago = (await novo({ gratuito: '', preco: '19,90', publicado: '1' }, { buffer: await pdfCom(1), originalname: 'p.pdf' })).ebook;
    const u = await usuario(1);
    assert.equal((await eb.acesso(null, gratis)).situacao, 'sem');
    assert.equal((await eb.acesso(u.id, gratis)).situacao, 'gratis');
    assert.equal((await eb.acesso(u.id, pago)).situacao, 'sem');
    const turma = await turmaOnline({ cursoId: pago.cursoId });
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 19.9, statusPagamento: 'PENDENTE' } });
    assert.equal((await eb.acesso(u.id, pago)).situacao, 'pendente');
    await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'PAGO', confirmadaEm: new Date() } });
    const a = await eb.acesso(u.id, pago);
    assert.equal(a.situacao, 'pago'); assert.ok(a.desde);
    // excluir com venda paga: recusado
    assert.match((await eb.excluir(pago.id)).erro, /compras/);
  });

  test('registrarDownload: grátis cria a posse uma vez só; 21º download na hora ⇒ LIMITE', async () => {
    const e = (await novo({ publicado: '1' }, { buffer: await pdfCom(1), originalname: 'g.pdf' })).ebook;
    const u = await usuario(2);
    await Promise.all([eb.registrarDownload(u.id, e), eb.registrarDownload(u.id, e)]);
    assert.equal(await prisma.acessoEbook.count({ where: { ebookId: e.id, usuarioId: u.id } }), 1);
    await prisma.downloadEbook.createMany({ data: Array.from({ length: 18 }, () => ({ ebookId: e.id, usuarioId: u.id })) });
    assert.deepEqual(await eb.registrarDownload(u.id, e), { erro: 'LIMITE' });
    assert.equal(await prisma.downloadEbook.count({ where: { ebookId: e.id, usuarioId: u.id } }), 20);
    const meus = await eb.meus(u.id);
    assert.ok(meus.some((x) => x.id === e.id));
  });

  test('doEndereco, daVitrine (só publicados com PDF, na ordem) e excluir sem compras', async () => {
    const e1 = (await novo({ nome: `Vitrine B ${s}`, publicado: '1', ordemVitrine: '2' }, { buffer: await pdfCom(1), originalname: 'a.pdf' })).ebook;
    const e2 = (await novo({ nome: `Vitrine A ${s}`, publicado: '1', ordemVitrine: '1' }, { buffer: await pdfCom(1), originalname: 'b.pdf' })).ebook;
    const rasc = (await novo({ nome: `Rascunho ${s}` })).ebook;
    const v = (await eb.daVitrine()).map((x) => x.id);
    assert.ok(v.indexOf(e2.id) < v.indexOf(e1.id) && v.indexOf(e2.id) !== -1);
    assert.ok(!v.includes(rasc.id));
    assert.equal((await eb.doEndereco(eb.endereco(`Vitrine A ${s}`))).id, e2.id);
    assert.equal(await eb.doEndereco(eb.endereco(`Rascunho ${s}`)), null);
    assert.equal((await eb.doEndereco(eb.endereco(`Rascunho ${s}`), { incluirRascunho: true })).id, rasc.id);
    assert.deepEqual(await eb.excluir(rasc.id), { ok: true });
    criados.splice(criados.indexOf(rasc), 1);
    assert.equal(await prisma.curso.count({ where: { id: rasc.cursoId } }), 0);
  });
});
