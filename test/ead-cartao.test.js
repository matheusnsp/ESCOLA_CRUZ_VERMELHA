// Cartão de bolso do curso online (src/lib/ead-cartao.js).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cartao = require('../src/lib/ead-cartao'); // no topo: erro aqui derruba o arquivo

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const nPaginas = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;

describe('paginasDoCartao (1 página por módulo, 2026-11-09)', () => {
  const tela = (id, extra = {}) => ({ id, titulo: id, revisaoItens: [id + '-1', id + '-2'], alerta: null, ...extra });
  test('capa + 1 página por módulo não final: 1º item de cada tela (máx. 6) e o 1º alerta', () => {
    const p = cartao.paginasDoCartao([
      { titulo: 'Engasgo', final: false, fotoIntroUrl: '/img/capa.webp', topicos: [
        { telas: [tela('a'), tela('b', { revisaoItens: [] }), tela('c', { alerta: 'primeiro alerta' })] },
        { telas: [tela('d', { alerta: 'segundo' }), tela('e'), tela('f'), tela('g'), tela('h')] },
      ] },
      { titulo: 'Juntando tudo', final: true, topicos: [{ telas: [tela('z')] }] },
      { titulo: 'Vazio', final: false, topicos: [] },
    ]);
    assert.deepEqual(p.map((x) => x.tipo), ['capa', 'modulo', 'modulo']);
    assert.deepEqual(p[1], { tipo: 'modulo', numero: 1, titulo: 'Engasgo', fotoUrl: '/img/capa.webp', passos: ['a-1', 'c-1', 'd-1', 'e-1', 'f-1', 'g-1'], alerta: 'primeiro alerta' });
    assert.deepEqual(p[2], { tipo: 'modulo', numero: 2, titulo: 'Vazio', fotoUrl: null, passos: [], alerta: null });
  });
  test('item em branco é pulado (pega o próximo não vazio da tela)', () => {
    const p = cartao.paginasDoCartao([{ titulo: 'M', final: false, topicos: [{ telas: [tela('a', { revisaoItens: ['  ', 'real'] })] }] }]);
    assert.deepEqual(p[1].passos, ['real']);
  });
});

const { test: t2 } = require('node:test');
t2('[revisão M1] paraPdf translitera letras fora do WinAnsi em vez de apagar (nomes na declaração)', () => {
  const { paraPdf } = require('../src/lib/ead-cartao');
  assert.equal(paraPdf('Łukasz Đorđe Šimić'), 'Lukasz Dorde Šimic');
  assert.equal(paraPdf("João D'Ávila Conceição"), "João D'Ávila Conceição");
});

describe('paraPdf (caracteres que a Helvetica do PDF não tem)', () => {
  test('setas, ≥ ≤, ✓ e emoji viram equivalentes; acentos e travessão ficam', () => {
    assert.equal(cartao.paraPdf('Tosse forte → leve ⇒ ok ≥ 80% ≤ 3 ✓ feito 📱'), 'Tosse forte › leve › ok >= 80% <= 3 feito');
    assert.equal(cartao.paraPdf('Mãos no pescoço — o sinal universal. Ação “certa”'), 'Mãos no pescoço — o sinal universal. Ação “certa”');
  });
});

describe('gerarCartao', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  let curso; let co;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'Primeiros Socorros Cartão', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Engasgo', ordem: 0 } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', telas: { create: [
      { ordem: 0, titulo: 'Com foto WEBP', fotoUrl: '/img/capa.webp', revisaoItens: ['Mãos no pescoço — o sinal universal.', 'Tosse forte → leve.', 'Sem voz → grave.', 'Lábios roxos → emergência.'], alerta: 'Se tosse com força, não bata nas costas.' },
      { ordem: 1, titulo: 'Foto fora do ar', fotoUrl: 'https://127.0.0.1:1/x.jpg', revisaoItens: ['um'] },
      { ordem: 2, titulo: 'Foto apagada', fotoUrl: '/uploads/nao-existe.webp', alerta: 'só alerta' },
      { ordem: 3, titulo: 'Sem nada' },
    ] } } });
    await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Final', ordem: 2, final: true } });
    const m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Título gigante '.repeat(40), ordem: 1, fotoIntroUrl: '/img/capa.webp' } });
    await prisma.topicoEad.create({ data: { moduloId: m2.id, titulo: 'T', telas: { create: [
      { ordem: 0, titulo: 'Longa', revisaoItens: ['palavra '.repeat(300)], alerta: 'alerta '.repeat(300) },
      ...Array.from({ length: 9 }, (_, i) => ({ ordem: i + 1, titulo: 'x' + i, revisaoItens: ['passo comprido de verdade número ' + i + ' '.repeat(1) + 'com mais texto para ocupar duas linhas no cartão'] })),
    ] } } });
  });
  after(async () => {
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('PDF com capa + 1 página por módulo (final fora), fonte Inter e vermelho do site', async () => {
    const { buffer, nomeArquivo } = await cartao.gerarCartao(co.id);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(nPaginas(buffer), 3);
    assert.match(buffer.toString('latin1'), /\/FontName\s*\/[A-Z]{6}\+Inter/);
    assert.match(buffer.toString('latin1'), /\/Subtype\s*\/Image/);
    assert.equal(nomeArquivo, 'cartao-de-bolso-primeiros-socorros-cartao.pdf');
  });

  test('carregarFoto: inexistente ou recusada ⇒ null; WEBP ⇒ JPEG', async () => {
    assert.equal(await cartao.carregarFoto('/uploads/nao-existe.webp'), null);
    assert.equal(await cartao.carregarFoto('https://127.0.0.1:1/x.jpg'), null);
    assert.equal(await cartao.carregarFoto('ftp://x/y.jpg'), null);
    const j = await cartao.carregarFoto('/img/capa.webp');
    assert.equal(j[0], 0xff); assert.equal(j[1], 0xd8); // assinatura JPEG
  });
});

test('registrarFontes: sem os arquivos da Inter, usa a Helvetica (não quebra)', () => {
  const PDFDocument = require('pdfkit');
  assert.deepEqual(cartao.registrarFontes(new PDFDocument(), '/nao/existe'), { R: 'Helvetica', B: 'Helvetica-Bold', K: 'Helvetica-Bold' });
  assert.deepEqual(cartao.registrarFontes(new PDFDocument()), { R: 'InterR', B: 'InterB', K: 'InterK' });
});

test('[revisão] a licença OFL da Inter vai junto com os arquivos da fonte', () => {
  const p = require('path').join(__dirname, '..', 'src', 'assets', 'fonts', 'OFL.txt');
  assert.match(require('fs').readFileSync(p, 'utf8'), /SIL Open Font License/);
});
