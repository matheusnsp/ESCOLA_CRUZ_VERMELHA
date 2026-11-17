// Transferência de turma (2026-11-17): muda só o valor do curso; a taxa de inscrição da matrícula fica como está.
// Caso real: Primeiros Socorros Básico 17/11 → 02/12, pagou R$ 150 com tudo incluso (sem taxa) e a transferência
// cobrou R$ 99 de taxa porque recalculava a taxa pela configuração atual do curso.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('prévia da transferência: não soma a taxa do curso de destino', () => {
  const v = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'transferir.ejs'), 'utf8');
  assert.doesNotMatch(v, /data-taxa=/);
  assert.match(v, /cursoAtual/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('calcularTransferencia', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { calcularTransferencia } = require('../src/lib/transferencia');
  const s = String(Date.now()).slice(-7);
  let ps; let caro; let t1; let t2; let t3; let u;
  before(async () => {
    ps = await prisma.curso.create({ data: { nome: `PS Básico transf ${s}`, cargaHoraria: 8, precoAvista: 150, precoCheio: 150, valorParcela: 150, taxaMatricula: 99 } });
    caro = await prisma.curso.create({ data: { nome: `Caro transf ${s}`, cargaHoraria: 8, precoAvista: 400, precoCheio: 450, valorParcela: 450, taxaMatricula: 50 } });
    t1 = await prisma.turma.create({ data: { cursoId: ps.id, inicioPrevisto: new Date('2099-11-17'), vagas: 30 } });
    t2 = await prisma.turma.create({ data: { cursoId: ps.id, inicioPrevisto: new Date('2099-12-02'), vagas: 30 } });
    t3 = await prisma.turma.create({ data: { cursoId: caro.id, inicioPrevisto: new Date('2099-12-05'), vagas: 30 } });
    u = await prisma.usuario.create({ data: { nome: 'Aluna Transf', email: `aluna-transf-${s}@teste.local` } });
  });
  after(async () => {
    await prisma.matricula.deleteMany({ where: { alunoId: u.id } });
    await prisma.turma.deleteMany({ where: { id: { in: [t1.id, t2.id, t3.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [ps.id, caro.id] } } });
    await prisma.usuario.delete({ where: { id: u.id } });
  });
  const carregar = (id) => prisma.matricula.findUnique({ where: { id }, include: { turma: { include: { curso: true } }, cupomEad: true } });

  test('mesmo curso, pago sem taxa (R$ 150 tudo incluso): nada a pagar', async () => {
    const m0 = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: t1.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 150, valorTaxaMatricula: 99, taxaConfirmada: true, statusPagamento: 'PAGO' } });
    const r = await calcularTransferencia(await carregar(m0.id), ps);
    assert.deepEqual(r, { valorAntigo: 150, valorNovo: 150, diferenca: 0 });
  });

  test('curso mais caro: a diferença é só do curso (sem taxa de novo)', async () => {
    const m = await prisma.matricula.findFirst({ where: { alunoId: u.id } });
    const r = await calcularTransferencia(await carregar(m.id), caro);
    assert.deepEqual(r, { valorAntigo: 150, valorNovo: 400, diferenca: 250 });
  });
});
