// Numeração dos certificados (lib/certificado.js): presencial e online na MESMA sequência do Livro.
// Banco LOCAL. Usa um livro próprio (9999) e restaura o livro atual no fim.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const cert = temBanco ? require('../src/lib/certificado') : null;

describe('numeração compartilhada', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const LIVRO = 9999;
  let livroAntes; let curso; let turma; let alunos = []; let mats = []; let co; let acs = [];

  before(async () => {
    livroAntes = await prisma.configuracao.findUnique({ where: { chave: 'cert_livro_atual' } });
    await prisma.configuracao.upsert({ where: { chave: 'cert_livro_atual' }, update: { valor: String(LIVRO) }, create: { chave: 'cert_livro_atual', valor: String(LIVRO) } });
    await prisma.logAuditoria.deleteMany({ where: { id: { startsWith: `cert-num-${LIVRO}-` } } });
    curso = await prisma.curso.create({ data: { nome: 'TESTE numeração', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    for (let i = 0; i < 7; i++) {
      const u = await prisma.usuario.create({ data: { nome: `Aluno ${String.fromCharCode(65 + i)} Numeração`, email: `num-${i}-${Date.now()}@teste.local`, papel: 'ALUNO' } });
      alunos.push(u);
    }
    for (const u of alunos.slice(0, 2)) mats.push(await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 0 } }));
    for (const u of alunos.slice(2)) acs.push(await prisma.alunoCursoEad.create({ data: { usuarioId: u.id, cursoOnlineId: co.id, concluidoEm: new Date() } }));
  });
  after(async () => {
    const ids = [...mats.map((m) => m.id), ...acs.map((a) => a.id)];
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ id: { startsWith: `cert-num-${LIVRO}-` } }, { id: { in: ids.map((i) => `certificado-${i}`) } }] } });
    if (livroAntes) await prisma.configuracao.update({ where: { chave: 'cert_livro_atual' }, data: { valor: livroAntes.valor } });
    else await prisma.configuracao.deleteMany({ where: { chave: 'cert_livro_atual' } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: alunos.map((u) => u.id) } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('presencial e online seguem a mesma sequência; repetir não gera outro número', async () => {
    assert.equal(await cert.numerar([mats[0].id], 'teste'), 1);
    const r1 = (await cert.lerNumero(mats[0].id)).registro;
    const e1 = await cert.numerarEad(acs[0].id, 'teste');
    assert.equal(e1.novo, true); assert.equal(e1.livro, LIVRO); assert.equal(e1.registro, r1 + 1);
    assert.ok(e1.emitidoEm instanceof Date);
    const e2 = await cert.numerarEad(acs[0].id, 'teste');
    assert.equal(e2.novo, false); assert.equal(e2.registro, r1 + 1);
    assert.equal(await cert.numerar([mats[1].id], 'teste'), 1);
    assert.equal((await cert.lerNumero(mats[1].id)).registro, r1 + 2);
  });

  test('online em paralelo: números distintos', async () => {
    const rs = await Promise.all(acs.slice(1).map((a) => cert.numerarEad(a.id, 'teste')));
    assert.equal(new Set(rs.map((r) => r.registro)).size, rs.length);
  });

  test('logs: presencial como Matricula (ações de sempre), online como AlunoCursoEad', async () => {
    const lp = await prisma.logAuditoria.findUnique({ where: { id: `certificado-${mats[0].id}` } });
    assert.equal(lp.acao, 'CERTIFICADO_EMITIDO'); assert.equal(lp.alvoTipo, 'Matricula');
    const lo = await prisma.logAuditoria.findUnique({ where: { id: `certificado-${acs[0].id}` } });
    assert.equal(lo.acao, 'CERTIFICADO_EMITIDO'); assert.equal(lo.alvoTipo, 'AlunoCursoEad');
    assert.equal(await cert.lerNumero('nao-existe'), null);
  });
});
