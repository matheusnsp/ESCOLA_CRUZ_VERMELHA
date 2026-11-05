// [revisão C1] A matrícula do curso online não pode passar por taxa de inscrição paga: nem a pendente
// (PIX abandonado) no Painel/Financeiro, nem a paga isentando a taxa do presencial (modo POR_ALUNO),
// nem bloqueando a matrícula rápida no presencial do mesmo curso.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { partesRecebidas } = require('../src/lib/financeiro-contas');

test('Financeiro: matrícula online pendente (sem taxa confirmada) não tem nada recebido', () => {
  assert.deepEqual(partesRecebidas({ statusPagamento: 'PENDENTE', taxaConfirmada: false, valorTaxaMatricula: 0, valorCurso: 49.9, plano: 'A_VISTA', pagamentos: [] }), []);
});

test('consultas do presencial que olham taxa/matrícula ativa deixam a turma ONLINE de fora', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.match(src('lib/matricula-rapida.js'), /const outraTurma = await prisma\.matricula\.findFirst\(\{\s*where: \{[^}]{0,200}?alunoId: aluno\.id, turma: \{ cursoId: turma\.cursoId, status: \{ not: 'ONLINE' \} \}/);
  assert.match(src('routes/admin.js'), /where: \{ taxaConfirmada: false, statusPagamento: \{ notIn: \['ESTORNADO', 'CANCELADO'\] \}, turma: \{ status: \{ not: 'ONLINE' \} \} \}/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('taxa POR_ALUNO', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { calcularValores } = require('../src/lib/matricula');
  const { turmaOnline } = require('../src/lib/turma-online');
  let curso; let co; let turma; let aluno; let modoAntes;
  before(async () => {
    modoAntes = await prisma.configuracao.findUnique({ where: { chave: 'matricula_modo' } });
    await prisma.configuracao.upsert({ where: { chave: 'matricula_modo' }, update: { valor: 'POR_ALUNO' }, create: { chave: 'matricula_modo', valor: 'POR_ALUNO' } });
    curso = await prisma.curso.create({ data: { nome: 'TESTE taxa por aluno online', cargaHoraria: 2, precoAvista: 200, precoCheio: 200, valorParcela: 200, taxaMatricula: 99 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9 } });
    turma = await turmaOnline(co);
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Taxa', email: `taxa-on-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, valorTaxaMatricula: 0, taxaConfirmada: true, statusPagamento: 'PAGO', confirmadaEm: new Date() } });
  });
  after(async () => {
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.usuario.delete({ where: { id: aluno.id } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    if (modoAntes) await prisma.configuracao.update({ where: { chave: 'matricula_modo' }, data: { valor: modoAntes.valor } });
    else await prisma.configuracao.delete({ where: { chave: 'matricula_modo' } });
    await prisma.$disconnect();
  });
  test('ter comprado o curso online não isenta a taxa do presencial', async () => {
    const v = await calcularValores(curso, 'A_VISTA', aluno.id);
    assert.equal(Number(v.valorTaxaMatricula), 99);
  });
});
