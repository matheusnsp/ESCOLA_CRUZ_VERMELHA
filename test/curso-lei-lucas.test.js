// Primeiro curso online de verdade (scripts/criar-curso-lei-lucas.js): o conteúdo cabe nos campos do painel,
// só falta o vídeo de cada tela para validar, e o script grava tudo em RASCUNHO, fora do site.
require('dotenv').config();
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const ead = require('../src/lib/ead');
const dados = require('../scripts/dados/curso-lei-lucas');
const { arvore } = require('../scripts/criar-curso-lei-lucas');

test('o conteúdo cabe nos campos do painel (mesmos limites dos formulários)', () => {
  for (const m of arvore(dados)) {
    const rm = ead.schemaModulo.safeParse({ titulo: m.titulo, minutosEstimados: m.minutosEstimados, introducao: m.introducao, final: m.final });
    assert.ok(rm.success, `${m.titulo}: ${ead.primeiroErro(rm)}`);
    for (const t of m.topicos) {
      assert.ok(ead.schemaTopico.safeParse({ titulo: t.titulo }).success, t.titulo);
      for (const tela of t.telas) {
        const r = ead.schemaTela.safeParse(tela);
        assert.ok(r.success, `${tela.titulo}: ${ead.primeiroErro(r)}`);
        assert.equal(r.data.revisaoItens.length, tela.revisaoItens.length, `${tela.titulo}: revisão com mais de 4 itens`);
      }
      for (const q of t.perguntas) {
        const r = ead.schemaPergunta.safeParse(q);
        assert.ok(r.success, `${q.enunciado}: ${ead.primeiroErro(r)}`);
        for (const a of q.alternativas) assert.ok(ead.schemaAlternativaTexto.safeParse(a.texto).success, a.texto);
      }
    }
    for (const c of m.cenarios) {
      assert.ok(ead.schemaCenario.safeParse(c).success, c.titulo);
      for (const d of c.decisoes) {
        const r = ead.schemaDecisao.safeParse(d);
        assert.ok(r.success, `${c.titulo}: ${ead.primeiroErro(r)}`);
      }
    }
  }
});

test('para validar, cada módulo só depende dos vídeos das telas', () => {
  const mods = arvore(dados);
  assert.equal(mods.length, 8);
  assert.equal(mods.filter((m) => m.final).length, 1);
  assert.ok(mods[mods.length - 1].final, 'o módulo final é o último');
  for (const m of mods) {
    const outras = ead.pendencias(m).filter((p) => !/: sem vídeo\.$/.test(p));
    assert.deepEqual(outras, [], m.titulo);
  }
  const videos = mods.flatMap((m) => ead.pendencias(m)).filter((p) => /sem vídeo/.test(p));
  assert.equal(videos.length, mods.flatMap((m) => m.topicos.flatMap((t) => t.telas)).length);
});

test('a alternativa certa muda de lugar e continua uma só', () => {
  const posicoes = new Set();
  for (const m of arvore(dados)) {
    for (const t of m.topicos) for (const q of t.perguntas) {
      assert.equal(q.alternativas.filter((a) => a.correta).length, 1, q.enunciado);
      posicoes.add(q.alternativas.findIndex((a) => a.correta));
    }
    for (const c of m.cenarios) for (const d of c.decisoes) assert.equal(d.opcoes.filter((o) => o.correta).length, 1, d.pergunta);
  }
  assert.ok(posicoes.size >= 3, 'a certa não fica sempre na mesma posição');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('gravar no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { criarCurso } = require('../scripts/criar-curso-lei-lucas');
  const nome = `Lei Lucas teste ${Date.now()}`;
  let co;

  after(async () => {
    if (co) {
      await prisma.logAuditoria.deleteMany({ where: { alvoId: co.id } });
      await prisma.cursoOnline.delete({ where: { id: co.id } });
      await prisma.curso.delete({ where: { id: co.cursoId } });
    }
    await prisma.$disconnect();
  });

  test('cria o curso só online, em rascunho, sem preço e fora do site', async () => {
    const r = await criarCurso({ ...dados, curso: { ...dados.curso, nome } });
    assert.equal(r.ok, true, r.erro);
    co = await prisma.cursoOnline.findUnique({ where: { id: r.co.id }, include: { curso: true, modulos: { include: { topicos: { include: { telas: true, perguntas: { include: { alternativas: true } } } }, cenarios: { include: { decisoes: { include: { opcoes: true } } } } } } } });
    assert.equal(co.somenteOnline, true);
    assert.equal(co.publicado, false);
    assert.equal(co.precoOnline, null);
    assert.equal(co.curso.ativo, false);
    assert.equal(co.curso.cargaHoraria, 3);
    assert.equal(co.modulos.length, 8);
    assert.ok(co.modulos.every((m) => m.status === 'RASCUNHO' && !m.geradoPorIa));
    const perguntas = co.modulos.flatMap((m) => m.topicos.flatMap((t) => t.perguntas));
    assert.equal(perguntas.length, 82);
    assert.ok(perguntas.every((q) => q.alternativas.filter((a) => a.correta).length === 1));
    assert.equal(co.modulos.find((m) => m.final).cenarios.length, 5);
    assert.ok(co.modulos.flatMap((m) => m.topicos.flatMap((t) => t.telas)).every((t) => t.videoUrl === null));
  });

  test('não cria de novo se o nome já existe', async () => {
    const r = await criarCurso({ ...dados, curso: { ...dados.curso, nome } });
    assert.equal(r.ok, false);
    assert.match(r.erro, /Já existe um curso/);
    assert.equal(await prisma.curso.count({ where: { nome } }), 1);
  });
});
