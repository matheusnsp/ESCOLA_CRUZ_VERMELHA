// 2026-11-16: turma que lota (inscrições pagas >= vagas) vira Confirmada sozinha e para de aceitar inscrição.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ct = require('../src/lib/concluir-turmas');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('turma lotada', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const sfx = String(Date.now()).slice(-7);
  let curso; const t = {}; const alunos = [];
  const fut = new Date(Date.now() + 20 * 86400000);
  const matricular = (turmaId, aluno, extra = {}) => prisma.matricula.create({ data: { alunoId: aluno.id, turmaId, plano: 'A_VISTA', forma: 'PIX', valorCurso: 100, valorTaxaMatricula: 10, taxaConfirmada: true, statusPagamento: 'PENDENTE', ...extra } });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Lotação ${sfx}`, cargaHoraria: 8, precoAvista: 100, precoCheio: 100, valorParcela: 100 } });
    for (const [k, vagas] of [['cheia', 2], ['quase', 3], ['soNaoPagos', 2], ['congelada', 2]]) {
      t[k] = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: fut, vagas, minimoAlunos: 0, status: k === 'congelada' ? 'CONGELADA' : 'ABERTA' } });
    }
    for (let i = 0; i < 4; i++) alunos.push(await prisma.usuario.create({ data: { nome: `Aluno Lotação ${i}`, email: `lot-${sfx}-${i}@teste.local`, papel: 'ALUNO' } }));
    await matricular(t.cheia.id, alunos[0]); await matricular(t.cheia.id, alunos[1], { statusPagamento: 'PAGO' });
    await matricular(t.quase.id, alunos[0]); await matricular(t.quase.id, alunos[1]);
    await matricular(t.quase.id, alunos[2], { statusPagamento: 'CANCELADO' }); // cancelada não ocupa vaga
    await matricular(t.soNaoPagos.id, alunos[0], { taxaConfirmada: false }); await matricular(t.soNaoPagos.id, alunos[1], { taxaConfirmada: false });
    await matricular(t.congelada.id, alunos[0]); await matricular(t.congelada.id, alunos[1]);
  });
  after(async () => {
    await prisma.matricula.deleteMany({ where: { turmaId: { in: Object.values(t).map((x) => x.id) } } });
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: alunos.map((a) => a.id) } } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  test('só a que atingiu as vagas com inscrição paga vira Confirmada', async () => {
    const n = await ct.confirmarTurmasLotadas();
    assert.ok(n >= 1);
    const st = async (k) => (await prisma.turma.findUnique({ where: { id: t[k].id } })).status;
    assert.equal(await st('cheia'), 'CONFIRMADA');
    assert.equal(await st('quase'), 'ABERTA', '2 de 3 (a cancelada não conta)');
    assert.equal(await st('soNaoPagos'), 'ABERTA', 'quem não pagou a inscrição não ocupa vaga');
    assert.equal(await st('congelada'), 'CONGELADA', 'só mexe em Aberta');
  });

  test('a rotina automática (antes de cada inscrição, de hora em hora, ao abrir Turmas) confere a lotação', async () => {
    await matricular(t.quase.id, alunos[3]);
    await ct.atualizarStatusTurmas();
    assert.equal((await prisma.turma.findUnique({ where: { id: t.quase.id } })).status, 'CONFIRMADA');
  });
});

test('telas e assistente explicam a regra', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(ler('src/views/admin/turma-form.ejs'), /quando as vagas enchem/);
  assert.match(ler('src/lib/assistente-manual.md'), /quando as vagas enchem/);
});
