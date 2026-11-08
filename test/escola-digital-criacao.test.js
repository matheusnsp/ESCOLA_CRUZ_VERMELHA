// Escola Digital (2026-11), Task 4: criação simplificada. Só trava o que o aluno precisa para o curso funcionar;
// o resto vira aviso ("Recomendado"). Lista fixa na página do módulo, tempo automático, tópicos de uma vez,
// segundo módulo final recusado, mover módulo não volta para rascunho.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ead = require('../src/lib/ead');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const tela = (titulo = 'Tela', extra = {}) => ({ titulo, ancora: null, videoUrl: null, ...extra });
const pergunta = (i, extra = {}) => ({ enunciado: `P${i}`, tipo: 'UNICA', ativa: true, feedback: null, alternativas: [{ texto: 'a', correta: true }, { texto: 'b', correta: false }], ...extra });
const minimo = () => ({ titulo: 'Módulo', introducao: null, minutosEstimados: 0, final: false, cenarios: [], topicos: [{ titulo: 'T1', telas: [tela()], perguntas: [] }] });
const finalMinimo = (nOpcoes = 2) => ({
  titulo: 'Final', introducao: null, minutosEstimados: 0, final: true, topicos: [],
  cenarios: [{ titulo: 'C1', cena: null, decisoes: [{ pergunta: 'E agora?', opcoes: Array.from({ length: nOpcoes }, (_, i) => ({ texto: `o${i}`, correta: i === 0, feedback: null })) }] }],
});
const tem = (lista, trecho) => assert.ok(lista.some((p) => p.includes(trecho)), `esperava "${trecho}" em ${JSON.stringify(lista)}`);

describe('regras de validação simplificadas', () => {
  test('módulo com 1 tópico, 1 tela sem vídeo e sem perguntas valida', () => {
    assert.deepEqual(ead.pendencias(minimo()), []);
    tem(ead.avisos(minimo()), 'Vídeo em todas as telas');
  });
  test('módulo sem tópicos não valida', () => {
    const m = minimo(); m.topicos = [];
    tem(ead.pendencias(m), 'Pelo menos 1 tópico com 1 tela');
  });
  test('tópico sem telas não valida, mesmo com perguntas', () => {
    const m = minimo(); m.topicos.push({ titulo: 'Só perguntas', telas: [], perguntas: [pergunta(1)] });
    tem(ead.pendencias(m), 'Todo tópico tem pelo menos 1 tela');
  });
  test('pergunta com alternativas inválidas não valida', () => {
    const m = minimo(); m.topicos[0].perguntas = [pergunta(1, { alternativas: [{ texto: 'a', correta: false }, { texto: 'b', correta: false }] })];
    tem(ead.pendencias(m), 'Perguntas com alternativas válidas');
  });
  test('poucas perguntas, sem porquê, sem âncora e sem introdução são só avisos', () => {
    const m = minimo(); m.topicos[0].perguntas = [pergunta(1)];
    assert.deepEqual(ead.pendencias(m), []);
    const a = ead.avisos(m);
    tem(a, '3 perguntas ou mais por tópico'); tem(a, '8 perguntas ou mais no módulo'); tem(a, 'O porquê'); tem(a, 'Âncora'); tem(a, 'Introdução');
  });
  test('final: decisão com 2 opções e 1 correta valida; com 5 opções não', () => {
    assert.deepEqual(ead.pendencias(finalMinimo(2)), []);
    tem(ead.pendencias(finalMinimo(5)), 'Toda decisão tem de 2 a 4 opções e 1 correta');
    tem(ead.avisos(finalMinimo(2)), 'Fala do instrutor');
    tem(ead.avisos(finalMinimo(2)), 'Cena');
  });
  test('final sem cenário e cenário sem decisão não validam', () => {
    const m = finalMinimo(); m.cenarios[0].decisoes = [];
    tem(ead.pendencias(m), 'Todo cenário tem decisão');
    m.cenarios = [];
    tem(ead.pendencias(m), 'Pelo menos 1 cenário');
  });
  test('checklist traz as duas listas com ok', () => {
    const c = ead.checklist(minimo());
    assert.ok(c.paraValidar.every((i) => i.ok));
    assert.ok(c.recomendado.some((i) => !i.ok));
    assert.ok(c.paraValidar.every((i) => typeof i.texto === 'string'));
  });
  test('minutosDoModulo: automático e o digitado', () => {
    const m = minimo(); m.topicos[0].telas.push(tela('2')); m.topicos[0].perguntas = [1, 2, 3, 4].map((i) => pergunta(i));
    assert.equal(ead.minutosDoModulo(m), 10);
    assert.equal(ead.minutosDoModulo({ ...m, minutosEstimados: 25 }), 25);
    assert.equal(ead.minutosDoModulo(finalMinimo()), 3);
  });
  test('número acima do máximo dá mensagem em português', () => {
    const r = ead.schemaModulo.safeParse({ titulo: 'x', minutosEstimados: 700, introducao: '', final: false });
    assert.equal(ead.primeiroErro(r), 'No máximo 600.');
  });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('painel: criação mais fácil', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  let srv; let co;
  const post = (u, campos) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos).toString() });

  before(async () => {
    const c = await prisma.curso.create({ data: { nome: `Curso Criação ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: c.id } });
    srv = await ouvir(montarPainel(`dev-criacao-${s}`));
  });
  after(async () => { srv.server.close(); await apagarCursosOnline(prisma, [co.id]); await prisma.$disconnect(); });

  test('módulo novo com "Tópicos (um por linha)" cria os tópicos na ordem', async () => {
    const r = await post(`/ead/curso/${co.id}/modulos/novo`, { titulo: 'Com tópicos', topicos: 'Primeiro\n\n  Segundo  \nTerceiro' });
    assert.equal(r.status, 302);
    const m = await prisma.moduloEad.findFirst({ where: { cursoOnlineId: co.id, titulo: 'Com tópicos' }, include: { topicos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual(m.topicos.map((t) => t.titulo), ['Primeiro', 'Segundo', 'Terceiro']);
  });

  test('segundo módulo final é recusado', async () => {
    await post(`/ead/curso/${co.id}/modulos/novo`, { titulo: 'Final A', final: 'on' });
    const r = await post(`/ead/curso/${co.id}/modulos/novo`, { titulo: 'Final B', final: 'on' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Este curso já tem um módulo final \(&#39;Final A&#39;\)/);
    assert.equal(await prisma.moduloEad.count({ where: { cursoOnlineId: co.id, final: true } }), 1);
  });

  test('mover módulo validado não volta para rascunho', async () => {
    const a = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Mover A', ordem: 10, status: 'VALIDADO' } });
    await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Mover B', ordem: 11, status: 'VALIDADO' } });
    const r = await post(`/ead/modulo/${a.id}/descer`, {});
    assert.equal(r.status, 302);
    assert.match(decodeURIComponent(r.headers.get('location')), /Ordem salva/);
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: a.id } })).status, 'VALIDADO');
  });

  test('página do módulo mostra "Para validar" e "Recomendado" desde o começo', async () => {
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Vazio', ordem: 20 } });
    const t = await (await fetch(`${srv.url}/ead/modulo/${m.id}`)).text();
    assert.match(t, /Para validar/);
    assert.match(t, /Recomendado/);
    assert.match(t, /Vídeo em todas as telas/);
    assert.doesNotMatch(t, /mínimo 3/, 'perguntas não são mais obrigatórias');
  });
});

describe('tela: "Salvar e escrever outra"', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7) + 't';
  let srv; let co; let topico;
  before(async () => {
    const c = await prisma.curso.create({ data: { nome: `Curso Tela Outra ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: c.id } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M', ordem: 0 } });
    topico = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T' } });
    srv = await ouvir(montarPainel(`dev-tela-${s}`));
  });
  after(async () => { srv.server.close(); await apagarCursosOnline(prisma, [co.id]); });
  test('volta para uma tela nova no mesmo tópico', async () => {
    const r = await fetch(`${srv.url}/ead/topico/${topico.id}/telas/nova`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ titulo: 'Primeira', depois: 'outra' }).toString() });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), new RegExp(`/ead/topico/${topico.id}/telas/nova`));
  });
});
