// Cartão de bolso do curso online (src/lib/ead-cartao.js).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cartao = require('../src/lib/ead-cartao'); // no topo: erro aqui derruba o arquivo

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const nPaginas = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;

describe('paginasDoCartao', () => {
  const tela = (id, extra = {}) => ({ id, titulo: id, revisaoItens: ['passo'], alerta: null, ...extra });
  test('capa + telas com revisão ou alerta, sem o módulo final', () => {
    const p = cartao.paginasDoCartao([
      { titulo: 'Engasgo', final: false, topicos: [{ telas: [tela('a'), tela('b', { revisaoItens: [], alerta: null })] }, { telas: [tela('c', { revisaoItens: [], alerta: 'cuidado' })] }] },
      { titulo: 'Juntando tudo', final: true, topicos: [] },
      { titulo: 'Sangramento', final: false, topicos: [{ telas: [tela('d')] }] },
    ]);
    assert.deepEqual(p.map((x) => (x.tipo === 'capa' ? 'capa' : x.tela.id)), ['capa', 'a', 'c', 'd']);
    assert.deepEqual(p.slice(1).map((x) => x.primeiraDoModulo), [true, false, true]);
    assert.deepEqual(p.slice(1).map((x) => x.modulo.numero), [1, 1, 2]);
  });
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
    await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Final', ordem: 1, final: true } });
  });
  after(async () => {
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('PDF com capa + 3 telas, foto WEBP convertida, fotos quebradas puladas', async () => {
    const { buffer, nomeArquivo } = await cartao.gerarCartao(co.id);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(nPaginas(buffer), 4);
    assert.match(buffer.toString('latin1'), /\/Subtype\s*\/Image/);
    assert.equal(nomeArquivo, 'cartao-de-bolso-primeiros-socorros-cartao.pdf');
    require('fs').writeFileSync('/tmp/claude-0/cartao-teste.pdf', buffer);
  });

  test('carregarFoto: inexistente ou recusada ⇒ null; WEBP ⇒ JPEG', async () => {
    assert.equal(await cartao.carregarFoto('/uploads/nao-existe.webp'), null);
    assert.equal(await cartao.carregarFoto('https://127.0.0.1:1/x.jpg'), null);
    assert.equal(await cartao.carregarFoto('ftp://x/y.jpg'), null);
    const j = await cartao.carregarFoto('/img/capa.webp');
    assert.equal(j[0], 0xff); assert.equal(j[1], 0xd8); // assinatura JPEG
  });
});
