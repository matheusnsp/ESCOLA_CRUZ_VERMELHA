// 2026-11-13: filtros (curso, turma, nota) e contas da página Pesquisa de satisfação.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pq = require('../src/lib/pesquisa');

const R = (o) => ({ nota: 5, comentario: '', autoriza: false, status: 'nova', curso: 'Bombeiro Civil', cursoId: 'bc', turmaId: 'bc1', inicioTurma: '2026-09-01T00:00:00Z', ...o });
const TODAS = [
  R({ nota: 5, comentario: 'ótimo', autoriza: true }),
  R({ nota: 4, turmaId: 'bc2', inicioTurma: '2026-10-06T00:00:00Z', status: 'aprovada', comentario: 'bom', autoriza: true }),
  R({ nota: 2, turmaId: 'bc2', inicioTurma: '2026-10-06T00:00:00Z', status: 'oculta' }),
  R({ nota: 3, curso: 'Primeiros Socorros', cursoId: 'ps', turmaId: 'ps1' }),
  // resposta antiga, sem cursoId/turmaId
  { nota: 1, comentario: 'ruim', autoriza: false, status: 'nova', curso: 'Cuidador', inicioTurma: '2026-08-01T00:00:00Z' },
];

test('chave do curso: cursoId, ou o nome em respostas antigas', () => {
  assert.equal(pq.chaveCurso(TODAS[0]), 'bc');
  assert.equal(pq.chaveCurso(TODAS[4]), 'nome:Cuidador');
});

test('filtrar por curso, turma e nota', () => {
  assert.equal(pq.filtrarRespostas(TODAS, {}).length, 5);
  assert.equal(pq.filtrarRespostas(TODAS, { curso: 'bc' }).length, 3);
  assert.equal(pq.filtrarRespostas(TODAS, { curso: 'bc', turma: 'bc2' }).length, 2);
  assert.deepEqual(pq.filtrarRespostas(TODAS, { nota: 'satisfeitos' }).map((r) => r.nota), [5, 4]);
  assert.deepEqual(pq.filtrarRespostas(TODAS, { nota: 'neutros' }).map((r) => r.nota), [3]);
  assert.deepEqual(pq.filtrarRespostas(TODAS, { nota: 'insatisfeitos' }).map((r) => r.nota), [2, 1]);
  assert.deepEqual(pq.filtrarRespostas(TODAS, { curso: 'nome:Cuidador' }).map((r) => r.nota), [1]);
});

test('resumo: média, distribuição, satisfeitos, comentários e depoimentos', () => {
  const s = pq.resumirRespostas(pq.filtrarRespostas(TODAS, { curso: 'bc' }));
  assert.equal(s.total, 3);
  assert.equal(s.media, 11 / 3);
  assert.deepEqual(s.dist, [0, 0, 1, 0, 1, 1]);
  assert.equal(s.satisfeitos, 2);
  assert.equal(s.insatisfeitos, 1);
  assert.equal(s.comComentario, 2);
  assert.equal(s.aprovadas, 1);
  assert.equal(s.aguardando, 1); // só comentário autorizado ainda "nova"
});

test('resumo sem respostas não divide por zero', () => {
  const s = pq.resumirRespostas([]);
  assert.equal(s.total, 0);
  assert.equal(s.media, 0);
  assert.deepEqual(s.dist, [0, 0, 0, 0, 0, 0]);
});

test('opções dos filtros: cursos por nome; turmas do curso, mais nova primeiro', () => {
  const o = pq.opcoesFiltro(TODAS, 'bc');
  assert.deepEqual(o.cursos.map((c) => c.nome), ['Bombeiro Civil', 'Cuidador', 'Primeiros Socorros']);
  assert.deepEqual(o.cursos.map((c) => c.id), ['bc', 'nome:Cuidador', 'ps']);
  assert.deepEqual(o.turmas.map((t) => t.id), ['bc2', 'bc1']);
  assert.equal(o.turmas[0].data, '2026-10-06T00:00:00Z');
  assert.deepEqual(pq.opcoesFiltro(TODAS, '').turmas, []);
});

test('média por curso: maior primeiro', () => {
  const m = pq.mediasPorCurso(TODAS);
  assert.deepEqual(m.map((c) => [c.id, c.total]), [['bc', 3], ['ps', 1], ['nome:Cuidador', 1]]);
  assert.equal(m[0].media, 11 / 3);
});

test('filtro da query: turma de outro curso e nota inválida são ignoradas', () => {
  assert.deepEqual(pq.filtroDaQuery({ curso: 'bc', turma: 'bc2', nota: 'satisfeitos' }, TODAS), { curso: 'bc', turma: 'bc2', nota: 'satisfeitos' });
  assert.deepEqual(pq.filtroDaQuery({ curso: 'bc', turma: 'ps1', nota: 'xyz' }, TODAS), { curso: 'bc', turma: '', nota: '' });
  assert.deepEqual(pq.filtroDaQuery({ turma: 'bc1' }, TODAS), { curso: '', turma: '', nota: '' });
  assert.deepEqual(pq.filtroDaQuery({ curso: 'nao-existe' }, TODAS), { curso: '', turma: '', nota: '' });
  assert.deepEqual(pq.filtroDaQuery({ curso: ['a', 'b'] }, TODAS), { curso: '', turma: '', nota: '' });
});

test('query string do filtro, sem campos vazios', () => {
  assert.equal(pq.qsFiltro({ curso: 'bc', turma: '', nota: 'neutros' }), 'curso=bc&nota=neutros');
  assert.equal(pq.qsFiltro({ curso: 'nome:Cuidador' }, { aba: 'todas' }), 'curso=nome%3ACuidador&aba=todas');
  assert.equal(pq.qsFiltro({}), '');
});

require('dotenv').config();
const { describe, after } = require('node:test');
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('envios contados pelo filtro', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const chave = 'pesquisa:envio:teste-filtro-' + Date.now();
  after(async () => { await prisma.configuracao.deleteMany({ where: { chave } }); await prisma.$disconnect(); });
  test('envio de matrícula de outro curso não conta; sem filtro conta todos', async () => {
    const m = await prisma.matricula.findFirst({ include: { turma: true } });
    if (!m) return;
    await prisma.configuracao.create({ data: { chave: chave.replace(/teste-filtro-\d+$/, m.id) + '', valor: 'x' } }).catch(() => {});
    const todos = await pq.contarEnvios();
    assert.ok(todos >= 1);
    assert.ok((await pq.contarEnvios({ curso: m.turma.cursoId })) >= 1);
    assert.ok((await pq.contarEnvios({ curso: m.turma.cursoId, turma: m.turmaId })) >= 1);
    assert.equal(await pq.contarEnvios({ curso: 'curso-que-nao-existe' }), 0);
    await prisma.configuracao.deleteMany({ where: { chave: 'pesquisa:envio:' + m.id, valor: 'x' } });
  });
});
