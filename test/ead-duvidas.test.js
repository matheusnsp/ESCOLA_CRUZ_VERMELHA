// Regras das dúvidas por aula (lib/ead-duvidas.js), contra o Postgres LOCAL. E-mail por espião.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { nomePublico } = require('../src/lib/ead-duvidas');

test('nomePublico: primeiro nome + inicial do último sobrenome', () => {
  assert.equal(nomePublico('Maria da Silva'), 'Maria S.');
  assert.equal(nomePublico('  maria   souza '), 'Maria S.');
  assert.equal(nomePublico('Ana'), 'Ana');
  assert.equal(nomePublico('JOÃO pedro'), 'João P.');
  assert.equal(nomePublico(''), 'Aluno');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('dúvidas no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const email = require('../src/lib/email');
  const d = require('../src/lib/ead-duvidas');
  const eadTeste = require('../src/lib/ead-teste');
  const { turmaOnline } = require('../src/lib/turma-online');
  const enviados = [];
  let curso; let co; let curso2; let co2; let tela; let tela2; let telaOutro; let ana; let bia; let acAna; let acBia; let acAna2; let codigo; let turma;

  before(async () => {
    email.enviarDuvidaRespondida = async (para, nome, dados) => { enviados.push({ para, nome, ...dados }); };
    const montar = async (nome) => {
      const c = await prisma.curso.create({ data: { nome, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
      const o = await prisma.cursoOnline.create({ data: { cursoId: c.id } });
      const m = await prisma.moduloEad.create({ data: { cursoOnlineId: o.id, titulo: 'Módulo A' } });
      const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'Tópico A', telas: { create: [{ titulo: 'Tela 1', ordem: 0 }, { titulo: 'Tela 2', ordem: 1 }] } }, include: { telas: { orderBy: { ordem: 'asc' } } } });
      return { c, o, telas: t.telas };
    };
    const a = await montar(`TESTE dúvidas ${Date.now()}`); curso = a.c; co = a.o; [tela, tela2] = a.telas;
    const b = await montar(`TESTE dúvidas 2 ${Date.now()}`); curso2 = b.c; co2 = b.o; [telaOutro] = b.telas;
    ana = await prisma.usuario.create({ data: { nome: 'Ana da Silva', email: `ana-duv-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Souza', email: `bia-duv-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    acAna = await prisma.alunoCursoEad.create({ data: { usuarioId: ana.id, cursoOnlineId: co.id } });
    acBia = await prisma.alunoCursoEad.create({ data: { usuarioId: bia.id, cursoOnlineId: co.id } });
    acAna2 = await prisma.alunoCursoEad.create({ data: { usuarioId: ana.id, cursoOnlineId: co2.id } });
    turma = await turmaOnline(co);
    await prisma.matricula.create({ data: { alunoId: ana.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 10, taxaConfirmada: true, statusPagamento: 'PAGO', confirmadaEm: new Date() } });
    codigo = await eadTeste.gerarCodigo(co.id);
  });
  after(async () => {
    const ids = (await prisma.duvidaEad.findMany({ where: { alunoCurso: { cursoOnlineId: { in: [co.id, co2.id] } } }, select: { id: true } })).map((x) => x.id);
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: ids } } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    await eadTeste.desligar(co.id);
    for (const o of [co, co2]) await prisma.cursoOnline.delete({ where: { id: o.id } });
    for (const c of [curso, curso2]) await prisma.curso.delete({ where: { id: c.id } });
    await prisma.$disconnect();
  });

  const texto = (n) => `Dúvida número ${n}, com texto suficiente.`;

  test('enviarDuvida: curta, longa, repetida e limite de 5 aguardando por curso', async () => {
    assert.deepEqual(await d.enviarDuvida({ alunoCursoId: acAna.id, telaId: tela.id, texto: 'curta dms' }), { ok: false, erro: 'curta' });
    assert.deepEqual(await d.enviarDuvida({ alunoCursoId: acAna.id, telaId: tela.id, texto: 'x'.repeat(1001) }), { ok: false, erro: 'longa' });
    const r1 = await d.enviarDuvida({ alunoCursoId: acAna.id, telaId: tela.id, texto: texto(1) });
    assert.equal(r1.ok, true); assert.ok(r1.duvida.id);
    assert.deepEqual(await d.enviarDuvida({ alunoCursoId: acAna.id, telaId: tela.id, texto: `  ${texto(1)} ` }), { ok: true, repetida: true });
    for (let i = 2; i <= 5; i++) assert.equal((await d.enviarDuvida({ alunoCursoId: acAna.id, telaId: tela2.id, texto: texto(i) })).ok, true);
    assert.deepEqual(await d.enviarDuvida({ alunoCursoId: acAna.id, telaId: tela.id, texto: texto(6) }), { ok: false, erro: 'limite' });
    // outro curso tem o próprio limite
    assert.equal((await d.enviarDuvida({ alunoCursoId: acAna2.id, telaId: telaOutro.id, texto: texto(7) })).ok, true);
    assert.equal(await prisma.duvidaEad.count({ where: { alunoCursoId: acAna.id } }), 5);
  });

  test('duvidasDaTela: respondida para todos, aguardando/descartada só para o autor, oculta para ninguém', async () => {
    const [d1] = await prisma.duvidaEad.findMany({ where: { alunoCursoId: acAna.id, telaId: tela.id } });
    const pBia = await d.enviarDuvida({ alunoCursoId: acBia.id, telaId: tela.id, texto: 'Pergunta da Bia que vai ser descartada.' });
    const pBia2 = await d.enviarDuvida({ alunoCursoId: acBia.id, telaId: tela.id, texto: 'Pergunta da Bia que vai sumir do ar.' });
    assert.deepEqual(await d.descartar(pBia.duvida.id, 'fora do assunto', 'dev'), { ok: true });
    assert.deepEqual(await d.responder(pBia2.duvida.id, 'Resposta.', 'dev', { linkBase: '/x' }), { ok: true });
    assert.deepEqual(await d.tirarDoAr(pBia2.duvida.id, 'dev'), { ok: true });
    // Bia: vê a própria descartada; não vê a aguardando da Ana; não vê a oculta
    let visto = await d.duvidasDaTela(tela.id, acBia.id);
    assert.deepEqual(visto.map((x) => [x.texto.slice(0, 18), x.status, x.minha]), [['Pergunta da Bia qu', 'DESCARTADA', true]]);
    // responde a da Ana: agora todos veem, com o nome público
    assert.deepEqual(await d.responder(d1.id, 'Esta é a resposta.', 'dev', { linkBase: '/online/c' }), { ok: true });
    visto = await d.duvidasDaTela(tela.id, acBia.id);
    const daAna = visto.find((x) => x.id === d1.id);
    assert.equal(daAna.nome, 'Ana S.'); assert.equal(daAna.minha, false); assert.equal(daAna.resposta, 'Esta é a resposta.');
    // visitante: só respondidas
    assert.deepEqual((await d.duvidasDaTela(tela.id, null)).map((x) => x.id), [d1.id]);
    // descartada não tem o motivo exposto
    assert.equal(visto.find((x) => x.status === 'DESCARTADA').motivoDescarte, undefined);
  });

  test('responder: duas ao mesmo tempo ⇒ uma ok, um e-mail só, link na âncora; vazia recusada', async () => {
    enviados.length = 0;
    const p = await d.enviarDuvida({ alunoCursoId: acBia.id, telaId: tela2.id, texto: 'Pergunta para responder duas vezes.' });
    assert.deepEqual(await d.responder(p.duvida.id, '   ', 'dev', { linkBase: '/online/x' }), { ok: false, erro: 'vazia' });
    assert.deepEqual(await d.responder(p.duvida.id, 'r'.repeat(2001), 'dev', { linkBase: '/online/x' }), { ok: false, erro: 'longa' });
    const rs = await Promise.all([1, 2].map((i) => d.responder(p.duvida.id, `Resposta ${i}`, 'dev', { linkBase: '/online/x' })));
    assert.equal(rs.filter((r) => r.ok).length, 1);
    assert.deepEqual(rs.find((r) => !r.ok), { ok: false, erro: 'ja_respondida' });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].para, bia.email);
    assert.match(enviados[0].link, new RegExp(`/online/x/tela/${tela2.id}#duvidas$`));
    assert.deepEqual(await d.responder('00000000-0000-4000-8000-000000000000', 'x', 'dev', { linkBase: '/x' }), { ok: false, erro: 'nao_achou' });
  });

  test('editarResposta sem e-mail, reabrir, auditoria', async () => {
    enviados.length = 0;
    const [r] = await prisma.duvidaEad.findMany({ where: { alunoCursoId: acBia.id, telaId: tela2.id } });
    assert.deepEqual(await d.editarResposta(r.id, 'Resposta corrigida.', 'dev'), { ok: true });
    assert.equal((await prisma.duvidaEad.findUnique({ where: { id: r.id } })).resposta, 'Resposta corrigida.');
    assert.equal(enviados.length, 0);
    const desc = await prisma.duvidaEad.findFirst({ where: { status: 'DESCARTADA', alunoCursoId: acBia.id } });
    assert.deepEqual(await d.reabrir(desc.id, 'dev'), { ok: true });
    assert.equal((await prisma.duvidaEad.findUnique({ where: { id: desc.id } })).status, 'AGUARDANDO');
    assert.deepEqual(await d.reabrir(r.id, 'dev'), { ok: false, erro: 'status' }); // respondida não reabre
    const acoes = (await prisma.logAuditoria.findMany({ where: { alvoTipo: 'DuvidaEad', alvoId: { in: [r.id, desc.id] } } })).map((l) => l.acao).sort();
    assert.deepEqual(acoes, ['EAD_DUVIDA_DESCARTOU', 'EAD_DUVIDA_EDITOU', 'EAD_DUVIDA_REABRIU', 'EAD_DUVIDA_RESPONDEU']);
  });

  test('marcarLidas e respondidasNaoLidas', async () => {
    const nl = await d.respondidasNaoLidas(acAna.id);
    assert.equal(nl.length, 1); assert.equal(nl[0].telaId, tela.id);
    await d.marcarLidas(acAna.id, tela.id);
    assert.deepEqual(await d.respondidasNaoLidas(acAna.id), []);
  });

  test('listarCentral e contarAguardando: origem e link do modo certo', async () => {
    const aguardando = await d.listarCentral({ status: 'AGUARDANDO', cursoOnlineId: co.id });
    assert.ok(aguardando.length >= 4);
    assert.ok(aguardando.every((x) => x.duvida.status === 'AGUARDANDO'));
    // mais antiga primeiro
    const datas = aguardando.map((x) => new Date(x.duvida.criadoEm).getTime());
    assert.deepEqual(datas, [...datas].sort((a, b) => a - b));
    const daAna = aguardando.find((x) => x.aluno.email === ana.email);
    assert.equal(daAna.origem, 'Pago'); assert.equal(daAna.linkBase, `/online/${curso.id}`);
    assert.equal(daAna.curso, curso.nome); assert.equal(daAna.modulo, 'Módulo A'); assert.ok(daAna.tela.titulo);
    const respondidas = await d.listarCentral({ status: 'RESPONDIDA', cursoOnlineId: co.id });
    const daBia = respondidas.find((x) => x.aluno.email === bia.email);
    assert.equal(daBia.origem, 'Teste'); assert.equal(daBia.linkBase, `/ead-teste/${codigo}`);
    // outro curso não entra no filtro; sem filtro, entra
    assert.ok(!(await d.listarCentral({ status: 'AGUARDANDO', cursoOnlineId: co.id })).some((x) => x.curso === curso2.nome));
    assert.ok((await d.listarCentral({ status: 'AGUARDANDO' })).some((x) => x.curso === curso2.nome));
    assert.equal(await d.contarAguardando(), await prisma.duvidaEad.count({ where: { status: 'AGUARDANDO' } }));
  });
});
