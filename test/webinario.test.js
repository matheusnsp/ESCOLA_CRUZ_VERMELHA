// Webinários (2026-11-13; spec 2026-11-13-escola-digital-webinarios-design.md §1–§3): regras da lib.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const wb = require('../src/lib/webinario');

const H = 3600 * 1000; const M = 60 * 1000;
const base = new Date('2026-11-20T22:00:00Z'); // 19h em Brasília

test('endereço igual ao do e-book (nome sem acento)', () => {
  assert.equal(wb.endereco('Primeiros Socorros: Bebês'), require('../src/lib/vitrine').slugCurso('Primeiros Socorros: Bebês'));
});

test('janela do ao vivo: abre 30 min antes, fecha 30 min depois do fim', () => {
  const w = { inicioEm: base, duracaoMin: 60 };
  assert.equal(wb.janela(w, new Date(base - 31 * M)), 'antes');
  assert.equal(wb.janela(w, new Date(base - 30 * M)), 'dentro');
  assert.equal(wb.janela(w, new Date(+base + 60 * M + 30 * M)), 'dentro');
  assert.equal(wb.janela(w, new Date(+base + 60 * M + 31 * M)), 'depois');
  assert.equal(wb.janela({ inicioEm: null, duracaoMin: 60 }, base), 'sem-data');
});

test('palavra-código: sem maiúsculas, acentos e espaços nas pontas; espaços internos contam', () => {
  assert.equal(wb.normalizarPalavra('  Coração '), 'coracao');
  assert.notEqual(wb.normalizarPalavra('Cruz  Vermelha'), wb.normalizarPalavra('cruz vermelha'));
  assert.equal(wb.cargaHorasDe(90), 2);
  assert.equal(wb.cargaHorasDe(60), 1);
});

test('cartão: uma situação por linha da tabela do §3', () => {
  const g = { gratuito: true, inicioEm: base, duracaoMin: 60, linkAoVivo: 'https://zoom.us/j/1', gravacaoUrl: null };
  const sem = { situacao: 'sem' }; const tem = { situacao: 'gratis' };
  assert.equal(wb.situacaoCartao(g, null, new Date(base - 2 * H)), 'visitante');
  assert.equal(wb.situacaoCartao(g, sem, new Date(base - 2 * H)), 'inscrever');
  assert.equal(wb.situacaoCartao({ ...g, gratuito: false }, sem, new Date(base - 2 * H)), 'comprar');
  assert.equal(wb.situacaoCartao({ ...g, gratuito: false }, { situacao: 'pendente' }, new Date(base - 2 * H)), 'pendente');
  assert.equal(wb.situacaoCartao(g, sem, new Date(+base + 3 * H)), 'encerrado-sem-gravacao');
  assert.equal(wb.situacaoCartao(g, tem, new Date(base - 2 * H)), 'inscrito-antes');
  assert.equal(wb.situacaoCartao(g, tem, base), 'transmissao');
  assert.equal(wb.situacaoCartao({ ...g, linkAoVivo: null }, tem, base), 'transmissao-sem-link');
  assert.equal(wb.situacaoCartao({ ...g, gravacaoUrl: 'https://www.youtube-nocookie.com/embed/x' }, tem, new Date(+base + 3 * H)), 'gravacao');
  assert.equal(wb.situacaoCartao(g, tem, new Date(+base + 3 * H)), 'gravacao-em-breve');
  assert.equal(wb.situacaoCartao({ ...g, inicioEm: null, gravacaoUrl: 'https://www.youtube-nocookie.com/embed/x' }, tem, base), 'gravacao');
  assert.equal(wb.situacaoCartao({ ...g, gratuito: false }, { situacao: 'cancelado' }, new Date(base - 2 * H)), 'comprar');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('salvar e excluir (banco)', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const criados = [];
  const nome = (s) => `Webinário teste ${s} ${Date.now()}`;
  after(async () => {
    for (const id of criados) await wb.excluir(id).catch(() => {});
    await prisma.$disconnect();
  });

  test('regras de publicar, gravação e duração', async () => {
    let r = await wb.salvar({ nome: nome('a'), gratuito: '1', duracaoMin: '60', publicado: '1', inicioEm: '2026-12-01T19:00' });
    assert.equal(r.erro, 'Para publicar, defina a palavra-código.');
    r = await wb.salvar({ nome: nome('b'), gratuito: '1', duracaoMin: '60', publicado: '1', palavraCodigo: 'Cruz' });
    assert.equal(r.erro, 'Para publicar, informe a data do ao vivo ou o link da gravação.');
    r = await wb.salvar({ nome: nome('c'), gratuito: '1', duracaoMin: '60', gravacaoUrl: 'https://x.com/v' });
    assert.equal(r.erro, 'Use um link do YouTube ou do Vimeo.');
    r = await wb.salvar({ nome: nome('d'), gratuito: '1', duracaoMin: '0' });
    assert.equal(r.erro, 'Informe a duração em minutos.');
    r = await wb.salvar({ nome: nome('e'), gratuito: '1', duracaoMin: '90', publicado: '1', palavraCodigo: 'Cruz', inicioEm: '2026-12-01T19:00', linkAoVivo: 'https://zoom.us/j/123' });
    assert.ok(r.webinario, r.erro); criados.push(r.webinario.id);
    assert.equal(r.webinario.inicioEm.toISOString(), '2026-12-01T22:00:00.000Z'); // 19h em Brasília
    assert.equal((await prisma.curso.findUnique({ where: { id: r.webinario.cursoId } })).cargaHoraria, 2);
    r = await wb.salvar({ nome: nome('f'), gratuito: '1', duracaoMin: '60', linkAoVivo: 'javascript:alert(1)' });
    assert.equal(r.erro, 'O link da transmissão precisa começar com https://');
  });

  test('grátis ↔ pago travado depois de inscrição; excluir com inscrição recusa', async () => {
    const r = await wb.salvar({ nome: nome('g'), gratuito: '1', duracaoMin: '60' });
    criados.push(r.webinario.id);
    const u = await prisma.usuario.create({ data: { nome: 'Aluno W', email: `w-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: r.webinario.id, usuarioId: u.id } });
    const r2 = await wb.salvar({ nome: r.webinario.curso.nome, gratuito: '', preco: '30', duracaoMin: '60' }, null, r.webinario.id);
    assert.equal(r2.erro, 'Não dá para trocar entre grátis e pago depois que alguém se inscreveu.');
    assert.match((await wb.excluir(r.webinario.id)).erro, /despublique/);
    await prisma.usuario.delete({ where: { id: u.id } }); // inscrição sai em cascata
    assert.equal(await prisma.inscricaoWebinario.count({ where: { webinarioId: r.webinario.id } }), 0);
  });
});
