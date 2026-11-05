// A turma ONLINE fica fora das rotinas do presencial (como a EM_ESPERA), mas o dinheiro dela conta.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const { turmaOnline, FORA_DO_PRESENCIAL } = require('../src/lib/turma-online');
const pesquisa = require('../src/lib/pesquisa');
const fs = require('fs');
const path = require('path');
const lembretes = require('../src/lib/lembretes');
const relatorio = require('../src/lib/relatorio');
const planilha = require('../src/lib/planilha-ao-vivo');

describe('turma ONLINE nas rotinas do presencial', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  let curso; let co; let turma; let u1; let u2; let pendente; let paga;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE exclusões online', cargaHoraria: 3, precoAvista: 100, precoCheio: 100, valorParcela: 100 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9 } });
    turma = await turmaOnline(co);
    u1 = await prisma.usuario.create({ data: { nome: 'Pendente Online', email: `pend-on-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    u2 = await prisma.usuario.create({ data: { nome: 'Paga Online', email: `paga-on-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    const base = { turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, valorTaxaMatricula: 0, taxaConfirmada: true };
    pendente = await prisma.matricula.create({ data: { ...base, alunoId: u1.id, statusPagamento: 'PENDENTE' } });
    paga = await prisma.matricula.create({ data: { ...base, alunoId: u2.id, statusPagamento: 'PAGO', confirmadaEm: new Date() } });
  });
  after(async () => {
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('lembrete avulso recusa a matrícula online', async () => {
    const r = await lembretes.enviarLembreteAvulso(pendente.id);
    assert.equal(r.ok, false); assert.match(r.motivo, /online/i);
  });

  test('relatório: pendente online fora das pendências; paga online soma no recebido', async () => {
    const d = (await relatorio.coletarDadosRelatorio(prisma)).financeiro;
    assert.equal(d.pendentesLista.some((p) => p.m.id === pendente.id), false);
    assert.equal(d.matriculaGeradaLista.some((m) => m.id === paga.id), true);
  });

  test('planilha ao vivo: rótulo "Curso online" e fora das turmas com vaga', () => {
    assert.equal(planilha._nomeTurma({ status: 'ONLINE', curso: { nome: 'X' }, inicioPrevisto: turma.inicioPrevisto }), 'X — Curso online');
    assert.equal(planilha._inicioTurma({ status: 'ONLINE', inicioPrevisto: turma.inicioPrevisto }), '');
  });

  test('turmas do presencial (GET /turmas, transferir, filtros) não trazem a online', async () => {
    assert.deepEqual(FORA_DO_PRESENCIAL, ['EM_ESPERA', 'ONLINE']);
    const ts = await prisma.turma.findMany({ where: { status: { notIn: FORA_DO_PRESENCIAL } }, select: { id: true } });
    assert.equal(ts.some((t) => t.id === turma.id), false);
  });

  test('pesquisa de satisfação não escolhe a turma online, mesmo com data passada', async () => {
    const antes = turma.inicioPrevisto;
    await prisma.turma.update({ where: { id: turma.id }, data: { inicioPrevisto: new Date(Date.now() - 3 * 24 * 3600000) } });
    try {
      const ids = await pesquisa.enviarPendentes({ simular: true });
      assert.equal(ids.includes(paga.id), false);
    } finally {
      await prisma.turma.update({ where: { id: turma.id }, data: { inicioPrevisto: antes } });
    }
  });
});

// Todo filtro que tira a turma de espera das rotinas do presencial também tira a online.
test('nenhum filtro de EM_ESPERA em src/ esquece a turma ONLINE', () => {
  const faltando = [];
  const varrer = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return varrer(f);
    if (!/\.(js|ejs)$/.test(e.name)) return;
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/not(In)?:\s*[\['"].*EM_ESPERA/.test(l) && !/ONLINE|FORA_DO_PRESENCIAL/.test(l)) faltando.push(`${path.relative(process.cwd(), f)}:${i + 1}`);
    });
  });
  varrer(path.join(__dirname, '..', 'src'));
  assert.deepEqual(faltando, []);
});

