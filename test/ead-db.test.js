// Testes de lib/ead-db.js contra um Postgres LOCAL (DATABASE_URL do .env). Sem banco, pula.
// Cria um curso próprio e apaga tudo no fim.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pular = temBanco ? false : 'sem DATABASE_URL local';
// No topo (não dentro do describe): erro de carregamento aqui derruba o arquivo e o npm test falha.
const prisma = temBanco ? require('../src/db') : null;
const edb = temBanco ? require('../src/lib/ead-db') : null;

describe('ead-db', { skip: pular }, () => {
  let curso; let co;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE ead-db', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
  });
  after(async () => {
    await prisma.cursoOnline.deleteMany({ where: { cursoId: curso.id } });
    await prisma.logAuditoria.deleteMany({ where: { atorId: 'teste-ead-db' } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const novoModulo = (dados = {}) => prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M', ...dados } });

  test('invalidarSeValidado: VALIDADO volta a RASCUNHO e registra', async () => {
    const m = await novoModulo({ status: 'VALIDADO', validadoPor: 'x', validadoEm: new Date() });
    const r = await prisma.$transaction((tx) => edb.invalidarSeValidado(tx, m.id, 'teste-ead-db', 'tela "X"'));
    assert.equal(r, true);
    const depois = await prisma.moduloEad.findUnique({ where: { id: m.id } });
    assert.equal(depois.status, 'RASCUNHO'); assert.equal(depois.validadoPor, null); assert.equal(depois.validadoEm, null);
    const logs = await prisma.logAuditoria.findMany({ where: { atorId: 'teste-ead-db', alvoId: m.id, acao: 'EAD_INVALIDOU_MODULO' } });
    assert.equal(logs.length, 1);
  });

  test('invalidarSeValidado: RASCUNHO não faz nada', async () => {
    const m = await novoModulo();
    assert.equal(await prisma.$transaction((tx) => edb.invalidarSeValidado(tx, m.id, 'teste-ead-db', 'x')), false);
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: m.id } }), 0);
  });

  test('mover: renumera ordens repetidas e troca; subir a primeira não muda nada', async () => {
    const m = await novoModulo();
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T' } });
    const telas = [];
    for (const titulo of ['a', 'b', 'c']) { telas.push(await prisma.telaEad.create({ data: { topicoId: t.id, titulo } })); await new Promise((r) => setTimeout(r, 5)); }
    const r = await prisma.$transaction((tx) => edb.mover(tx, 'telaEad', telas[2].id, 'subir', 'topicoId'));
    assert.deepEqual(r, { trocadoCom: telas[1].id });
    const ordem = (await prisma.telaEad.findMany({ where: { topicoId: t.id }, orderBy: { ordem: 'asc' } })).map((x) => x.titulo);
    assert.deepEqual(ordem, ['a', 'c', 'b']);
    assert.equal(await prisma.$transaction((tx) => edb.mover(tx, 'telaEad', telas[0].id, 'subir', 'topicoId')), null);
    assert.equal(await prisma.$transaction((tx) => edb.mover(tx, 'telaEad', telas[1].id, 'descer', 'topicoId')), null);
  });

  test('mover módulos ignora o módulo final (ele fica sempre por último na tela)', async () => {
    const co2 = await prisma.cursoOnline.create({ data: { cursoId: (await prisma.curso.create({ data: { nome: 'TESTE ead-db 2', cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } })).id } });
    const a = await prisma.moduloEad.create({ data: { cursoOnlineId: co2.id, titulo: 'A', ordem: 0 } });
    await prisma.moduloEad.create({ data: { cursoOnlineId: co2.id, titulo: 'Final', ordem: 1, final: true } });
    const c = await prisma.moduloEad.create({ data: { cursoOnlineId: co2.id, titulo: 'C', ordem: 2 } });
    const r = await prisma.$transaction((tx) => edb.mover(tx, 'moduloEad', c.id, 'subir', 'cursoOnlineId', { final: false }));
    assert.deepEqual(r, { trocadoCom: a.id });
    const comuns = (await prisma.moduloEad.findMany({ where: { cursoOnlineId: co2.id, final: false }, orderBy: { ordem: 'asc' } })).map((x) => x.titulo);
    assert.deepEqual(comuns, ['C', 'A']);
    await prisma.cursoOnline.delete({ where: { id: co2.id } });
    await prisma.curso.delete({ where: { id: co2.cursoId } });
  });

  test('proximaOrdem', async () => {
    const m = await novoModulo();
    assert.equal(await edb.proximaOrdem(prisma, 'topicoEad', 'moduloId', m.id), 0);
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', ordem: 4 } });
    assert.equal(await edb.proximaOrdem(prisma, 'topicoEad', 'moduloId', m.id), 5);
  });

  test('marcarFinal: só um final por curso; recusa módulo com tópico', async () => {
    const a = await novoModulo(); const b = await novoModulo();
    assert.deepEqual(await prisma.$transaction((tx) => edb.marcarFinal(tx, a.id, true)), {});
    assert.deepEqual(await prisma.$transaction((tx) => edb.marcarFinal(tx, b.id, true)), {});
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: a.id } })).final, false);
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: b.id } })).final, true);
    const c = await novoModulo();
    await prisma.topicoEad.create({ data: { moduloId: c.id, titulo: 'T' } });
    assert.ok((await prisma.$transaction((tx) => edb.marcarFinal(tx, c.id, true))).erro);
    await prisma.cenarioEad.create({ data: { moduloId: b.id, titulo: 'C' } });
    assert.ok((await prisma.$transaction((tx) => edb.marcarFinal(tx, b.id, false))).erro);
  });

  test('marcarFinal: recusa trocar o final se o atual tem cenários; sem cenários, troca e invalida o anterior', async () => {
    const curso2 = await prisma.curso.create({ data: { nome: 'TESTE ead-db 3', cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    const c2 = await prisma.cursoOnline.create({ data: { cursoId: curso2.id } });
    const a = await prisma.moduloEad.create({ data: { cursoOnlineId: c2.id, titulo: 'A', final: true, status: 'VALIDADO', validadoEm: new Date() } });
    await prisma.cenarioEad.create({ data: { moduloId: a.id, titulo: 'C' } });
    const b = await prisma.moduloEad.create({ data: { cursoOnlineId: c2.id, titulo: 'B' } });
    const r = await prisma.$transaction((tx) => edb.marcarFinal(tx, b.id, true, 'teste-ead-db'));
    assert.match(r.erro || '', /'A'/);
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: a.id } })).final, true);
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: b.id } })).final, false);
    await prisma.cenarioEad.deleteMany({ where: { moduloId: a.id } });
    assert.deepEqual(await prisma.$transaction((tx) => edb.marcarFinal(tx, b.id, true, 'teste-ead-db')), {});
    const antes = await prisma.moduloEad.findUnique({ where: { id: a.id } });
    assert.equal(antes.final, false); assert.equal(antes.status, 'RASCUNHO');
    await prisma.cursoOnline.delete({ where: { id: c2.id } }); await prisma.curso.delete({ where: { id: curso2.id } });
  });

  test('moduloDe e carregarModulo', async () => {
    const m = await novoModulo();
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T' } });
    const q = await prisma.perguntaEad.create({ data: { topicoId: t.id, enunciado: 'E', alternativas: { create: [{ texto: 'a', correta: true }] } } });
    assert.deepEqual(await edb.moduloDe('pergunta', q.id), { moduloId: m.id, cursoOnlineId: co.id });
    assert.equal(await edb.moduloDe('tela', q.id), null);
    const arv = await edb.carregarModulo(m.id);
    assert.equal(arv.cursoOnline.curso.nome, 'TESTE ead-db');
    assert.equal(arv.topicos[0].perguntas[0].alternativas[0].texto, 'a');
    assert.equal(await edb.carregarModulo('00000000-0000-0000-0000-000000000000'), null);
    assert.equal(await edb.carregarModulo('nao-e-uuid'), null);
  });
});
