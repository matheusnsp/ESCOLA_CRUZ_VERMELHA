// lib/cobranca-avista.js: a cobrança à vista (PIX ou crédito) que o POST /inscrever usa e que a compra
// do curso online reaproveita. O gateway é sempre falso aqui.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('iniciarCobrancaAVista', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { iniciarCobrancaAVista, urlRetorno } = require('../src/lib/cobranca-avista');
  let curso; let turma; let aluno; let mPix; let mCred; let mErro;
  const chamadas = [];
  const falso = async (dados) => { chamadas.push(dados); return { gatewayRef: 'ref-' + chamadas.length, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR-FALSO', pixUrl: null, pixBase64: null }; };
  const base = (m, forma) => ({ matricula: m, nomeCurso: 'Curso X', total: 120, forma, aluno, origem: null });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE cobrança à vista', cargaHoraria: 1, precoAvista: 120, precoCheio: 120, valorParcela: 120 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: new Date(Date.now() + 30 * 864e5), vagas: 10 } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Cobrança', email: `cob-${Date.now()}@teste.local`, papel: 'ALUNO', cpfCnpj: '52998224725' } });
    const dados = { turmaId: turma.id, plano: 'A_VISTA', valorCurso: 120, valorTaxaMatricula: 0, statusPagamento: 'PENDENTE' };
    mPix = await prisma.matricula.create({ data: { ...dados, alunoId: aluno.id, forma: 'PIX' } });
    const a2 = await prisma.usuario.create({ data: { nome: 'Aluno Cred', email: `cob2-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    const a3 = await prisma.usuario.create({ data: { nome: 'Aluno Erro', email: `cob3-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    mCred = await prisma.matricula.create({ data: { ...dados, alunoId: a2.id, forma: 'CREDITO' } });
    mErro = await prisma.matricula.create({ data: { ...dados, alunoId: a3.id, forma: 'PIX' } });
  });
  after(async () => {
    const ids = [mPix, mCred, mErro].map((m) => m.id);
    const alunos = [mPix, mCred, mErro].map((m) => m.alunoId);
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ids } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: alunos } } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('CREDITO: volta para o retorno sem criar Pagamento nem chamar o gateway', async () => {
    const r = await iniciarCobrancaAVista({ ...base(mCred, 'CREDITO'), criarTransacao: falso });
    assert.match(r.redirect, new RegExp(`^/inscricao/retorno\\?matriculaId=${mCred.id}&pix=0&etapa=curso&t=\\d+$`));
    assert.equal(await prisma.pagamento.count({ where: { matriculaId: mCred.id } }), 0);
    assert.equal(chamadas.length, 0);
  });

  test('PIX: cria 1 Pagamento PENDENTE com o QR do gateway e volta com pix=1', async () => {
    const r = await iniciarCobrancaAVista({ ...base(mPix, 'PIX'), criarTransacao: falso });
    assert.match(r.redirect, /pix=1&etapa=curso/);
    const ps = await prisma.pagamento.findMany({ where: { matriculaId: mPix.id } });
    assert.equal(ps.length, 1);
    assert.equal(ps[0].status, 'PENDENTE'); assert.equal(ps[0].pixQrCode, 'QR-FALSO'); assert.equal(ps[0].gatewayRef, 'ref-1');
    assert.equal(ps[0].tipo, 'CURSO'); assert.equal(Number(ps[0].valor), 120);
    assert.equal(chamadas[0].valorTotal, 120); assert.equal(chamadas[0].forma, 'PIX'); assert.equal(chamadas[0].nomeCurso, 'Curso X');
    assert.equal(chamadas[0].aluno.cidade, 'Rio de Janeiro');
  });

  test('PIX de novo em menos de 30 min: reaproveita o QR, sem novo Pagamento', async () => {
    const r = await iniciarCobrancaAVista({ ...base(mPix, 'PIX'), criarTransacao: falso });
    assert.match(r.redirect, /pix=1/);
    assert.equal(await prisma.pagamento.count({ where: { matriculaId: mPix.id } }), 1);
    assert.equal(chamadas.length, 1);
  });

  test('gateway falha e nunca grava a ref: Pagamento CANCELADO e { erro }', async () => {
    const r = await iniciarCobrancaAVista({ ...base(mErro, 'PIX'), criarTransacao: async () => { throw new Error('caiu'); }, esperaMs: 1 });
    assert.ok(r.erro); assert.equal(r.redirect, undefined);
    const p = await prisma.pagamento.findFirst({ where: { matriculaId: mErro.id } });
    assert.equal(p.status, 'CANCELADO');
  });

  test('urlRetorno mantém o formato', () => {
    assert.match(urlRetorno('abc', { pix: true, etapa: 'taxa' }), /^\/inscricao\/retorno\?matriculaId=abc&pix=1&etapa=taxa&t=\d+$/);
  });
});
