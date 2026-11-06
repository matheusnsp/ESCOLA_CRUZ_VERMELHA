// Regras do cupom de desconto do curso online (etapa 7). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../src/lib/ead-cupom');

test('normalizarCodigo tira espaços e põe em maiúsculas; codigoValido', () => {
  assert.equal(C.normalizarCodigo(' lei lucas10 '), 'LEILUCAS10');
  assert.equal(C.normalizarCodigo(null), '');
  assert.equal(C.codigoValido('LEI-10'), true);
  assert.equal(C.codigoValido('AB'), false);
  assert.equal(C.codigoValido('LEI_10'), false);
  assert.equal(C.codigoValido('A'.repeat(31)), false);
});

test('calcularDesconto: % arredondado ao centavo, R$ limitado ao preço', () => {
  assert.deepEqual(C.calcularDesconto({ tipo: 'PERCENTUAL', valor: 15 }, 49.9), { precoCheio: 49.9, desconto: 7.49, precoFinal: 42.41 });
  assert.deepEqual(C.calcularDesconto({ tipo: 'VALOR', valor: 60 }, 49.9), { precoCheio: 49.9, desconto: 49.9, precoFinal: 0 });
  assert.deepEqual(C.calcularDesconto({ tipo: 'PERCENTUAL', valor: '100' }, 49.9), { precoCheio: 49.9, desconto: 49.9, precoFinal: 0 });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('cupom no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  const cod = (x) => `T${s}-${x}`;
  let curso; let co; let co2; let turma; let aluno; const mats = [];

  const ontem = () => new Date(Date.now() - 864e5);
  const compra = async (cupom, status, desconto = 5) => {
    const m = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 45, statusPagamento: status, valorTaxaMatricula: 0 } }).catch(async (e) => {
      if (e.code !== 'P2002') throw e;
      const t = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
      return prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: t.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 45, statusPagamento: status, valorTaxaMatricula: 0 } });
    });
    mats.push(m);
    await prisma.cupomMatriculaEad.create({ data: { matriculaId: m.id, cupomId: cupom.id, precoCheio: 50, desconto, precoFinal: 50 - desconto } });
    return m;
  };

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Cupom ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 50 } });
    const c2 = await prisma.curso.create({ data: { nome: `Curso Cupom B ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co2 = await prisma.cursoOnline.create({ data: { cursoId: c2.id, precoOnline: 80 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Cupom', email: `al-cupom-${s}@teste.local`, papel: 'ALUNO' } });
  });
  after(async () => {
    const cupons = await prisma.cupomEad.findMany({ where: { codigo: { startsWith: `T${s}-` } } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { cupomId: { in: cupons.map((c) => c.id) } } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: cupons.map((c) => c.id) } } });
    await prisma.cupomEad.deleteMany({ where: { id: { in: cupons.map((c) => c.id) } } });
    await prisma.matricula.deleteMany({ where: { alunoId: aluno.id } });
    await prisma.turma.deleteMany({ where: { cursoId: { in: [curso.id, co2.cursoId] } } });
    await prisma.usuario.delete({ where: { id: aluno.id } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: [co.id, co2.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [curso.id, co2.cursoId] } } });
    await prisma.$disconnect();
  });

  const novo = async (x, extra = {}) => {
    const r = await C.criarCupom({ codigo: cod(x), tipo: 'PERCENTUAL', valor: 10, cursoOnlineId: null, validoAte: null, limiteUsos: null, observacao: '', ...extra }, 'dev');
    assert.ok(r.cupom, r.erro);
    return r.cupom;
  };

  test('criar: grava em maiúsculas; código repetido (até em minúsculas) ⇒ erro; validações', async () => {
    const c = await novo('rep');
    assert.equal(c.codigo, cod('REP'));
    assert.equal((await C.criarCupom({ codigo: cod('rep').toLowerCase(), tipo: 'VALOR', valor: 5 }, 'dev')).erro, 'Já existe um cupom com esse código.');
    assert.equal((await C.criarCupom({ codigo: 'AB', tipo: 'VALOR', valor: 5 }, 'dev')).erro, 'Código: 3 a 30 letras, números ou hífen.');
    assert.equal((await C.criarCupom({ codigo: cod('p0'), tipo: 'PERCENTUAL', valor: 101 }, 'dev')).erro, 'Desconto em %: de 1 a 100.');
    assert.equal((await C.criarCupom({ codigo: cod('v0'), tipo: 'VALOR', valor: 0 }, 'dev')).erro, 'Desconto em R$: maior que zero.');
    assert.equal((await C.criarCupom({ codigo: cod('l0'), tipo: 'VALOR', valor: 5, limiteUsos: 0 }, 'dev')).erro, 'Limite de usos: 1 ou mais.');
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: c.id, acao: 'EAD_CUPOM_CRIADO' } }), 1);
  });

  test('validarCupom: cada motivo com a mensagem exata', async () => {
    assert.equal((await C.validarCupom('NAO-EXISTE-' + s, co)).erro, 'Cupom não encontrado.');
    const inativo = await novo('ina');
    await C.ativarCupom(inativo.id, false, 'dev');
    assert.equal((await C.validarCupom(inativo.codigo, co)).erro, 'Cupom não encontrado.');
    const outro = await novo('outro', { cursoOnlineId: co2.id });
    assert.equal((await C.validarCupom(outro.codigo, co)).erro, 'Este cupom não vale para este curso.');
    const venceu = await novo('venc', { validoAte: ontem() });
    assert.equal((await C.validarCupom(venceu.codigo, co)).erro, 'Este cupom venceu.');
    const hoje = await novo('hoje', { validoAte: new Date(Date.now() - 60e3) }); // hoje, minutos atrás: vale até o fim do dia
    assert.equal((await C.validarCupom(hoje.codigo, co)).erro, undefined);
    const todos = await novo('todos', { tipo: 'VALOR', valor: 7.5 });
    const r = await C.validarCupom(` ${todos.codigo.toLowerCase()} `, co2);
    assert.equal(r.cupom.id, todos.id);
    assert.deepEqual([r.precoCheio, r.desconto, r.precoFinal], [80, 7.5, 72.5]);
  });

  test('usos: só pagos e parcelados contam; limite atingido ⇒ esgotado', async () => {
    const c = await novo('lim', { limiteUsos: 1 });
    await compra(c, 'PENDENTE');
    assert.equal(await C.usosDoCupom(c.id), 0);
    assert.equal((await C.validarCupom(c.codigo, co)).erro, undefined);
    await compra(c, 'PARCELADO');
    assert.equal(await C.usosDoCupom(c.id), 1);
    assert.equal((await C.validarCupom(c.codigo, co)).erro, 'Este cupom já foi usado o número máximo de vezes.');
  });

  test('alterar: com compra registrada, código e tipo não mudam; validade muda', async () => {
    const c = await novo('alt');
    await compra(c, 'PENDENTE');
    const base = { codigo: c.codigo, tipo: 'PERCENTUAL', valor: 10, cursoOnlineId: null, validoAte: null, limiteUsos: null, observacao: '' };
    assert.equal((await C.alterarCupom(c.id, { ...base, codigo: cod('alt2') }, 'dev')).erro, 'Este cupom já foi usado: o código e o tipo não mudam.');
    assert.equal((await C.alterarCupom(c.id, { ...base, tipo: 'VALOR' }, 'dev')).erro, 'Este cupom já foi usado: o código e o tipo não mudam.');
    const r = await C.alterarCupom(c.id, { ...base, validoAte: ontem(), limiteUsos: 3 }, 'dev');
    assert.ok(r.cupom);
    assert.equal(r.cupom.limiteUsos, 3);
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: c.id, acao: 'EAD_CUPOM_ALTERADO' } }), 1);
  });

  test('apagar: com compra ⇒ erro; sem compra ⇒ some', async () => {
    const usado = await novo('apg1');
    await compra(usado, 'CANCELADO');
    assert.equal((await C.apagarCupom(usado.id, 'dev')).erro, 'Este cupom já foi usado e não pode ser apagado.');
    const livre = await novo('apg2');
    assert.equal((await C.apagarCupom(livre.id, 'dev')).ok, true);
    assert.equal(await prisma.cupomEad.count({ where: { id: livre.id } }), 0);
  });

  test('listarCupons: usos e total de desconto só das pagas; filtro de ativos; comprasDoCupom', async () => {
    const c = await novo('lst', { cursoOnlineId: co.id });
    await compra(c, 'PAGO', 5);
    await compra(c, 'PENDENTE', 5);
    const l = (await C.listarCupons({})).find((x) => x.id === c.id);
    assert.equal(l.usos, 1);
    assert.equal(l.totalDesconto, 5);
    assert.equal(l.curso, `Curso Cupom ${s}`);
    await C.ativarCupom(c.id, false, 'dev');
    assert.ok(!(await C.listarCupons({ ativos: true })).some((x) => x.id === c.id));
    assert.ok((await C.listarCupons({ ativos: false })).some((x) => x.id === c.id));
    const cs = await C.comprasDoCupom(c.id);
    assert.equal(cs.length, 2);
    assert.equal(cs[0].aluno.nome, 'Aluno Cupom');
    assert.ok(cs.every((x) => x.precoFinal === 45 && ['PAGO', 'PENDENTE'].includes(x.situacao)));
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: c.id, acao: 'EAD_CUPOM_DESATIVADO' } }), 1);
  });
});
