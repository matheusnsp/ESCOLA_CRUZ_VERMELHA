// E-books (2026-11-09): arquivo do e-book (src/lib/ebook-arquivo.js) — PDF válido, pasta privada e marca no rodapé.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');

process.env.EBOOKS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ebooks-'));
delete process.env.SUPABASE_URL;
const arq = require('../src/lib/ebook-arquivo');

async function pdfCom(n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([300, 400]).drawText('pagina ' + (i + 1), { x: 20, y: 300 });
  return Buffer.from(await d.save());
}
// Texto visível no conteúdo do PDF (as streams vêm comprimidas): junta tudo descomprimido.
function conteudo(buf) {
  const s = buf.toString('latin1'); let out = s; const re = /stream\r?\n([\s\S]*?)endstream/g; let m;
  while ((m = re.exec(s))) { try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) { /* não comprimida */ } }
  return out;
}

test('lerPdf: conta as páginas; bytes que não são PDF ⇒ PDF_INVALIDO', async () => {
  assert.deepEqual(await arq.lerPdf(await pdfCom(3)), { paginas: 3 });
  await assert.rejects(arq.lerPdf(Buffer.from('não sou um pdf')), /PDF_INVALIDO/);
  await assert.rejects(arq.lerPdf(Buffer.from('%PDF-1.7\n%%EOF')), /PDF_INVALIDO/);
});

test('marcar: mesmas páginas, texto no rodapé, nome fora do WinAnsi não quebra', async () => {
  const marcado = await arq.marcar(await pdfCom(3), 'Licenciado para Łukasz Ação · CPF 123.***.***-45 · 09/11/2026');
  assert.equal((await arq.lerPdf(marcado)).paginas, 3);
  const c = conteudo(marcado);
  // pdf-lib escreve o texto em hexadecimal (<4C6963...>): procura "Licenciado" codificado.
  const hex = Buffer.from('Licenciado para Lukasz A', 'latin1').toString('hex').toUpperCase();
  assert.ok(c.toUpperCase().includes(hex), 'rodapé no conteúdo das páginas');
});

test('guardar/ler/apagar na pasta privada; caminho para fora da pasta ⇒ null', async () => {
  const buf = await pdfCom(1);
  const caminho = await arq.guardar(buf, 'meu livro.pdf');
  assert.match(caminho, /^local:[\w-]+\.pdf$/);
  assert.deepEqual(await arq.ler(caminho), buf);
  assert.equal(await arq.ler('local:../../etc/passwd'), null);
  assert.equal(await arq.ler('local:nao-existe.pdf'), null);
  await arq.apagar(caminho);
  assert.equal(await arq.ler(caminho), null);
});

test('primeirasPaginas: corta para n páginas (o que vai para a IA)', async () => {
  const curto = await arq.primeirasPaginas(await pdfCom(9), 4);
  assert.equal((await arq.lerPdf(curto)).paginas, 4);
});

test('textoDoRodape: nome, documento mascarado e data', () => {
  const d = new Date('2026-11-09T15:00:00Z');
  assert.equal(arq.textoDoRodape({ nome: 'Ana Paula', cpfCnpj: '12345678945' }, d), 'Licenciado para Ana Paula · CPF 123.***.***-45 · 09/11/2026');
  assert.equal(arq.textoDoRodape({ nome: 'John', cpfCnpj: null, passaporte: 'X123' }, d), 'Licenciado para John · Passaporte *** · 09/11/2026');
});
