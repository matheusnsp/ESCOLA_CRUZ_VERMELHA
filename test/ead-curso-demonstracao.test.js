// scripts/ead-curso-demonstracao.js: o curso de demonstração sai completo e publicável.
require('dotenv').config();
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('curso de demonstração', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { criarCursoDemonstracao, removerCursoDemonstracao } = require('../scripts/ead-curso-demonstracao');
  const { podePublicar } = require('../src/lib/ead-publicacao');
  const { tamanhoPreTeste } = require('../src/lib/ead-progresso');
  const eadTeste = require('../src/lib/ead-teste');
  const nome = `TESTE demonstração ${Date.now()}`;
  after(async () => { await removerCursoDemonstracao(nome); await prisma.$disconnect(); });

  test('cria tudo validado, publicável, com pré-teste, cenários e link de teste; o online fica fora do site', async () => {
    const { curso, co, codigo } = await criarCursoDemonstracao({ nome });
    const c = await prisma.cursoOnline.findUnique({
      where: { id: co.id },
      include: { modulos: { orderBy: { ordem: 'asc' }, include: { topicos: { include: { telas: true, perguntas: { include: { alternativas: true } } } }, cenarios: { include: { decisoes: { include: { opcoes: true } } } } } } },
    });
    assert.equal(c.modulos.length, 5);
    assert.deepEqual(podePublicar(c), []);
    assert.equal(c.publicado, false); assert.equal(curso.ativo, false); assert.equal(Number(c.precoOnline), 49.9);
    for (const m of c.modulos.filter((x) => !x.final)) {
      const perguntas = m.topicos.flatMap((t) => t.perguntas);
      assert.equal(perguntas.length, 8); assert.ok(tamanhoPreTeste(perguntas.length) > 0, 'pré-teste disponível');
      assert.ok(m.topicos.every((t) => t.telas.length >= 2));
      for (const p of perguntas) assert.equal(p.alternativas.filter((a) => a.correta).length, 1);
    }
    // a certa não fica sempre em primeiro
    const posicoes = new Set(c.modulos.flatMap((m) => m.topicos.flatMap((t) => t.perguntas.map((p) => p.alternativas.findIndex((a) => a.correta)))));
    assert.ok(posicoes.size > 1);
    const fin = c.modulos.find((m) => m.final);
    assert.equal(fin.cenarios.length, 2);
    for (const d of fin.cenarios.flatMap((x) => x.decisoes)) { assert.equal(d.opcoes.filter((o) => o.correta).length, 1); assert.ok(d.opcoes.every((o) => o.feedback)); }
    assert.equal(await eadTeste.cursoDoCodigo(codigo), co.id);
  });
});
