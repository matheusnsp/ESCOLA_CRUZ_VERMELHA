// Escrever com IA (2026-11-09), Task 1: textos do curso pelo Claude (exemplos, validação, dúvidas). Postgres LOCAL.
// Spec: docs/superpowers/specs/2026-11-09-ia-textos-curso.md
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/lib/ead-ia-esquema');
const txt = require('../src/lib/ia-textos');
const { clienteFalso } = require('./helpers/ia-falso');

const faq = (i) => ({ pergunta: `Pergunta ${i}?`, resposta: `Resposta ${i}.` });

test('validarTextos: corta nos limites, 10 dúvidas → 6, sem repetidas nem vazias', () => {
  const j = { descricao: 'a'.repeat(400), descricaoLonga: 'b'.repeat(4000), conteudoProgramatico: 'c'.repeat(5000),
    faqs: [faq(1), faq(1), { pergunta: '  ', resposta: 'x' }, { pergunta: 'p'.repeat(300), resposta: 'r'.repeat(900) }, ...[2, 3, 4, 5, 6, 7, 8].map(faq)] };
  const t = E.validarTextos(j, 'presencial');
  assert.equal(t.descricao.length, 300);
  assert.equal(t.descricaoLonga.length, 3000);
  assert.equal(t.conteudoProgramatico.length, 4000);
  assert.equal(t.faqs.length, 6);
  assert.equal(t.faqs.filter((f) => f.pergunta === 'Pergunta 1?').length, 1);
  assert.equal(t.faqs[1].pergunta.length, 200);
  assert.equal(t.faqs[1].resposta.length, 600);
  const o = E.validarTextos({ descricao: 'd'.repeat(1200), faqs: [] }, 'online');
  assert.equal(o.descricao.length, 1000);
  assert.deepEqual(o.faqs, []);
  assert.equal(o.descricaoLonga, undefined);
});

test('lerFaqsDoForm: só as marcadas, sem vazias, cortes, no máximo 6', () => {
  const body = { faqsIa: [
    { usar: '1', pergunta: 'A?', resposta: 'a' }, { pergunta: 'B?', resposta: 'b' }, { usar: '1', pergunta: '', resposta: 'c' },
    { usar: '1', pergunta: 'x'.repeat(250), resposta: 'y'.repeat(700) }, ...Array.from({ length: 50 }, (_, i) => ({ usar: '1', pergunta: `P${i}?`, resposta: 'r' })),
  ] };
  const f = txt.lerFaqsDoForm(body);
  assert.equal(f.length, 6);
  assert.deepEqual(f[0], { pergunta: 'A?', resposta: 'a' });
  assert.equal(f[1].pergunta.length, 200);
  assert.equal(f[1].resposta.length, 600);
  assert.deepEqual(txt.lerFaqsDoForm({}), []);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('textos com IA: banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  const ids = [];
  let pres; let outro;
  before(async () => {
    const mk = (nome, extra) => prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 8, precoAvista: 100, precoCheio: 120, valorParcela: 40, ativo: true, ...extra } });
    pres = await mk('Curso Textos Alvo', { descricao: 'curta', descricaoLonga: 'longa alvo' });
    outro = await mk('Curso Textos Exemplo', { descricao: 'Exemplo curto', descricaoLonga: 'Exemplo de descrição longa' });
    ids.push(pres.id, outro.id);
    await prisma.faqCurso.create({ data: { cursoId: pres.id, pergunta: 'Tem certificado?', resposta: 'Sim.', ordem: 0 } });
  });
  after(async () => {
    await prisma.faqCurso.deleteMany({ where: { cursoId: { in: ids } } });
    await prisma.curso.deleteMany({ where: { id: { in: ids } } });
  });

  test('exemplos: até 3, do mesmo tipo, sem o próprio curso', async () => {
    const ex = await txt.exemplos('presencial', pres.id);
    assert.ok(ex.length >= 1 && ex.length <= 3);
    assert.ok(!ex.some((e) => e.nome === pres.nome));
  });

  test('escrever: manda exemplos, ideias e regras; esforço baixo; devolve os textos validados', async () => {
    const cli = clienteFalso([() => ({ descricao: 'Nova curta', descricaoLonga: 'Nova longa', conteudoProgramatico: 'Item 1\nItem 2', faqs: [faq(1), faq(2), faq(3), faq(4), faq(5)] })]);
    const r = await txt.escrever({ tipo: 'presencial', dados: { nome: pres.nome, cargaHoraria: 8 }, ideias: 'foco em professores', cursoId: pres.id }, { cliente: cli });
    assert.equal(r.textos.descricao, 'Nova curta');
    assert.equal(r.textos.faqs.length, 5);
    const p = cli.chamadas[0];
    assert.equal(p.output_config.effort, 'low');
    const texto = p.messages[0].content.map((c) => c.text).join('\n');
    assert.match(texto, /foco em professores/);
    assert.match(texto, /Exemplo de descrição longa|Exemplo curto/);
    assert.doesNotMatch(texto, /longa alvo/, 'o próprio curso não é exemplo');
    assert.match(JSON.stringify(p.system), /preço/i);
  });

  test('salvarFaqs: acrescenta depois das existentes e não repete pergunta igual', async () => {
    const n = await txt.salvarFaqs(pres.id, [{ pergunta: 'tem certificádo? ', resposta: 'repetida' }, faq(9), faq(10)]);
    assert.equal(n, 2);
    const lista = await prisma.faqCurso.findMany({ where: { cursoId: pres.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(lista.map((f) => f.pergunta), ['Tem certificado?', 'Pergunta 9?', 'Pergunta 10?']);
    assert.deepEqual(lista.map((f) => f.ordem), [0, 1, 2]);
  });
});
