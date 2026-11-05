// lib/ead-progresso-db.js contra o Postgres LOCAL. Cria um curso e um aluno próprios e apaga no fim.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const pdb = temBanco ? require('../src/lib/ead-progresso-db') : null;

describe('ead-progresso-db', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  let curso; let co; let mod; let top; let mod2; let fin; let cen; let aluno; let outro; let ac; let acOutro;
  const alt = (certa) => ({ create: [{ texto: 'certa', correta: true, ordem: 0 }, { texto: 'errada', correta: false, ordem: 1 }].map((a) => ({ ...a })) });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE progresso-db', cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    mod = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    top = await prisma.topicoEad.create({ data: { moduloId: mod.id, titulo: 'T1', telas: { create: [{ titulo: 'a', ordem: 0 }, { titulo: 'b', ordem: 1 }] } } });
    for (let i = 0; i < 6; i++) await prisma.perguntaEad.create({ data: { topicoId: top.id, enunciado: `P${i}`, feedback: 'f', alternativas: alt() } });
    mod2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M2', ordem: 1 } });
    const t2 = await prisma.topicoEad.create({ data: { moduloId: mod2.id, titulo: 'T2' } });
    for (let i = 0; i < 8; i++) await prisma.perguntaEad.create({ data: { topicoId: t2.id, enunciado: `Q${i}`, feedback: 'f', alternativas: alt() } });
    fin = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'F', ordem: 2, final: true } });
    cen = await prisma.cenarioEad.create({ data: { moduloId: fin.id, titulo: 'C', decisoes: { create: [0, 1].map((o) => ({ ordem: o, pergunta: `D${o}`, opcoes: { create: [0, 1, 2].map((k) => ({ ordem: k, texto: `O${k}`, correta: k === 2, feedback: `fala ${k}` })) } })) } } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Teste', email: `aluno-pdb-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    outro = await prisma.usuario.create({ data: { nome: 'Outro Teste', email: `outro-pdb-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    ac = await pdb.garantirAlunoCurso(aluno.id, co.id);
    acOutro = await pdb.garantirAlunoCurso(outro.id, co.id);
  });
  after(async () => {
    await prisma.usuario.deleteMany({ where: { id: { in: [aluno.id, outro.id] } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('garantirAlunoCurso é idempotente', async () => {
    assert.equal((await pdb.garantirAlunoCurso(aluno.id, co.id)).id, ac.id);
  });

  test('carregarCursoParaAluno: ordem e perguntas ativas', async () => {
    const { co: c, curso: k } = await pdb.carregarCursoParaAluno(co.id);
    assert.equal(c.curso.nome, 'TESTE progresso-db');
    assert.deepEqual(k.modulos.map((m) => m.id), [mod.id, mod2.id, fin.id]);
    assert.equal(k.modulos[0].topicos[0].nPerguntasAtivas, 6);
    assert.equal(k.modulos[1].nPerguntasAtivas, 8);
    assert.equal(k.modulos[2].cenarios.length, 1);
  });

  test('marcarTelaVista duas vezes = 1 linha', async () => {
    const tela = await prisma.telaEad.findFirst({ where: { topicoId: top.id } });
    await pdb.marcarTelaVista(ac.id, tela.id); await pdb.marcarTelaVista(ac.id, tela.id);
    assert.equal(await prisma.telaVistaEad.count({ where: { alunoCursoId: ac.id } }), 1);
    assert.ok((await pdb.carregarProgresso(ac.id)).telasVistas.has(tela.id));
  });

  test('abrirQuiz reaproveita a aberta; a próxima evita as anteriores', async () => {
    const a = await pdb.abrirQuiz(ac.id, top.id);
    assert.equal(a.perguntaIds.length, 3); assert.equal(a.total, 3); assert.equal(a.tipo, 'QUIZ');
    assert.equal((await pdb.abrirQuiz(ac.id, top.id)).id, a.id);
    for (const pid of a.perguntaIds) {
      const certa = await prisma.alternativaEad.findFirst({ where: { perguntaId: pid, correta: true } });
      await pdb.responder(a.id, ac.id, pid, [certa.id]);
    }
    const fechada = await prisma.tentativaEad.findUnique({ where: { id: a.id } });
    assert.equal(fechada.aprovado, true); assert.ok(fechada.concluidaEm);
    const b = await pdb.abrirQuiz(ac.id, top.id);
    assert.notEqual(b.id, a.id);
    assert.equal(b.perguntaIds.filter((id) => a.perguntaIds.includes(id)).length, 0);
  });

  test('responder fora de ordem é ignorado; respostas em paralelo contam 1 vez', async () => {
    const t = await pdb.abrirQuiz(acOutro.id, top.id);
    const r0 = await pdb.responder(t.id, acOutro.id, t.perguntaIds[1], []);
    assert.equal(r0.ignorada, true);
    const certa = await prisma.alternativaEad.findFirst({ where: { perguntaId: t.perguntaIds[0], correta: true } });
    const rs = await Promise.all([1, 2, 3].map(() => pdb.responder(t.id, acOutro.id, t.perguntaIds[0], [certa.id])));
    assert.equal(rs.filter((r) => !r.ignorada).length, 1);
    const depois = await prisma.tentativaEad.findUnique({ where: { id: t.id } });
    assert.equal(depois.respostas.length, 1); assert.equal(depois.acertos, 1);
  });

  test('tentativaDoAluno: de outro aluno é null; pergunta apagada sai da conta', async () => {
    const t = await pdb.abrirQuiz(acOutro.id, top.id); // a aberta do teste anterior (1 respondida)
    assert.equal(await pdb.tentativaDoAluno(t.id, ac.id), null);
    const apagada = t.perguntaIds[2];
    await prisma.perguntaEad.delete({ where: { id: apagada } });
    const tt = await pdb.tentativaDoAluno(t.id, acOutro.id);
    assert.equal(tt.perguntas.length, 2); assert.equal(tt.total, 2);
    const atual = pdb.perguntaAtual(tt);
    assert.equal(atual.id, t.perguntaIds[1]);
    const certa = atual.alternativas.find((x) => x.correta);
    const r = await pdb.responder(t.id, acOutro.id, atual.id, [certa.id]);
    assert.equal(r.fechou, true);
    assert.equal(r.tentativa.aprovado, true); // 2 de 2
    assert.equal(r.tentativa.total, 2);
  });

  test('tentativa que perdeu todas as perguntas aparece fechada e não aprovada', async () => {
    const t2 = await prisma.topicoEad.create({ data: { moduloId: mod.id, titulo: 'T vazio', ordem: 5 } });
    const ps = [];
    for (let i = 0; i < 3; i++) ps.push(await prisma.perguntaEad.create({ data: { topicoId: t2.id, enunciado: `Z${i}`, feedback: 'f', alternativas: alt() } }));
    const t = await pdb.abrirQuiz(ac.id, t2.id);
    await prisma.perguntaEad.deleteMany({ where: { topicoId: t2.id } });
    const tt = await pdb.tentativaDoAluno(t.id, ac.id);
    assert.equal(pdb.perguntaAtual(tt), null);
    assert.equal(tt.aprovado, false); assert.ok(tt.concluidaEm);
    await prisma.topicoEad.delete({ where: { id: t2.id } });
  });

  test('abrirPreTeste: 8 perguntas; segunda vez null; módulo com menos de 8 null', async () => {
    const p1 = await pdb.abrirPreTeste(ac.id, mod2.id);
    assert.equal(p1.perguntaIds.length, 8); assert.equal(p1.tipo, 'PRE_TESTE');
    assert.equal(await pdb.abrirPreTeste(ac.id, mod2.id), null);
    assert.equal(await pdb.abrirPreTeste(ac.id, mod.id), null); // M1 tem 5 ativas agora
  });

  test('cenário: errada soma erro, fora de ordem ignora, certa na última conclui', async () => {
    await pdb.comecarCenario(ac.id, cen.id);
    const ds = await prisma.decisaoCenario.findMany({ where: { cenarioId: cen.id }, orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } });
    const r1 = await pdb.escolherNoCenario(ac.id, cen.id, ds[0].id, ds[0].opcoes[0].id);
    assert.equal(r1.certa, false); assert.equal(r1.opcao.feedback, 'fala 0'); assert.equal(r1.feito.erros, 1);
    assert.equal((await pdb.escolherNoCenario(ac.id, cen.id, ds[1].id, ds[1].opcoes[2].id)).ignorada, true);
    assert.equal((await pdb.escolherNoCenario(ac.id, cen.id, ds[0].id, ds[0].opcoes[2].id)).certa, true);
    const r4 = await pdb.escolherNoCenario(ac.id, cen.id, ds[1].id, ds[1].opcoes[2].id);
    assert.equal(r4.fechou, true); assert.ok(r4.feito.concluidoEm); assert.ok(r4.feito.tempoSeg >= 0);
    const re = await pdb.comecarCenario(ac.id, cen.id);
    assert.equal(re.erros, 0); assert.equal(re.decisaoAtual, 0); assert.equal(re.concluidoEm, null);
  });

  test('excluir o usuário apaga o progresso (cascata)', async () => {
    const u = await prisma.usuario.create({ data: { nome: 'Some Logo', email: `some-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    const x = await pdb.garantirAlunoCurso(u.id, co.id);
    await prisma.usuario.delete({ where: { id: u.id } });
    assert.equal(await prisma.alunoCursoEad.findUnique({ where: { id: x.id } }), null);
  });
});
