// Etapa 8: Financeiro — estornos de quem comprou de novo, lote a receber fora da tabela de pagamentos e lotes
// recebidos no OFX. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cpf = require('./helpers/cpf');

const F = require('../src/lib/financeiro-estornos');

test('lotesDaTabela: só os lotes recebidos entram na tabela de pagamentos', () => {
  const linhas = [{ tipo: 'lote', loteId: 'a' }, { tipo: 'lote_a_receber', loteId: 'b' }];
  assert.deepEqual(F.lotesDaTabela(linhas).map((x) => x.loteId), ['a']);
});

test('admin.js usa os estornos de recompra e a tabela só com lotes recebidos', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.match(src, /estornosExtras\(/);
  assert.match(src, /lotesDaTabela\(/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('estornos e OFX no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const L = require('../src/lib/ead-lote');
  const { coletarLancamentosOfx } = require('../src/lib/relatorio');
  require('../src/lib/email').enviarGestorEscola = async () => {};
  const s = String(Date.now()).slice(-7);
  let cursoOn; let cursoPres; let tOn; let tPres; let co; let aluno; const ids = {};

  const pag = (matriculaId, valor, status, minutosAtras) => prisma.pagamento.create({ data: { matriculaId, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor, status, atualizadoEm: new Date(Date.now() - minutosAtras * 60e3) } });

  before(async () => {
    aluno = await prisma.usuario.create({ data: { nome: 'Aluno Estorno', email: `al-est-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    cursoOn = await prisma.curso.create({ data: { nome: `Curso Est On ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: cursoOn.id, precoOnline: 49.9 } });
    cursoPres = await prisma.curso.create({ data: { nome: `Curso Est Pres ${s}`, cargaHoraria: 2, precoAvista: 200, precoCheio: 200, valorParcela: 200 } });
    tOn = await prisma.turma.create({ data: { cursoId: cursoOn.id, status: 'ONLINE', vagas: 0 } });
    tPres = await prisma.turma.create({ data: { cursoId: cursoPres.id, status: 'ABERTA', vagas: 10 } });
    const outra = await prisma.turma.create({ data: { cursoId: cursoOn.id, status: 'ONLINE', vagas: 0 } });
    // Online: estornada e comprada de novo (status PAGO), um pagamento estornado antigo.
    ids.recompra = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: tOn.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true } });
    ids.pAntigo = await pag(ids.recompra.id, 49.9, 'ESTORNADO', 60);
    await pag(ids.recompra.id, 49.9, 'PAGO', 10);
    // Online: estornada de novo (status ESTORNADO), dois pagamentos estornados.
    ids.duas = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: outra.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 40, valorTaxaMatricula: 0, statusPagamento: 'ESTORNADO' } });
    ids.pDuasVelho = await pag(ids.duas.id, 45, 'ESTORNADO', 120);
    ids.pDuasNovo = await pag(ids.duas.id, 40, 'ESTORNADO', 5);
    // Presencial: estornada e paga de novo.
    ids.pres = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: tPres.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 200, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true } });
    ids.pPres = await pag(ids.pres.id, 200, 'ESTORNADO', 30);
    // Presencial estornado "apenas contábil": as 3 tentativas (PIX vencido, cartão recusado, PIX pago) viram ESTORNADO.
    const tPres2 = await prisma.turma.create({ data: { cursoId: cursoPres.id, status: 'ABERTA', vagas: 10 } });
    ids.manual = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: tPres2.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 300, valorTaxaMatricula: 0, statusPagamento: 'ESTORNADO' } });
    for (const v of [300, 300, 300]) await pag(ids.manual.id, v, 'ESTORNADO', 50);
    // E o mesmo, mas a pessoa comprou de novo: 3 estornados (tentativas) + 1 pago.
    const tPres3 = await prisma.turma.create({ data: { cursoId: cursoPres.id, status: 'ABERTA', vagas: 10 } });
    ids.manualRecompra = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: tPres3.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 300, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true } });
    for (const v of [300, 300, 300]) await pag(ids.manualRecompra.id, v, 'ESTORNADO', 50);
    await pag(ids.manualRecompra.id, 300, 'PAGO', 5);
    // Lotes: um recebido ontem, um recebido há 40 dias.
    const g = { nome: 'Gestor Est', email: `g-est-${s}@teste.local`, celular: '', cpf: cpf() };
    const mk = async (nome, recebidoEm) => (await L.criarLote({ escola: { nome: `${nome} ${s}` }, cursoOnlineId: co.id, vagas: 5, validoAte: new Date(Date.now() + 864e5), valor: 750, forma: 'EMPENHO', recebidoEm, gestor: g, atorId: 'dev' })).lote;
    ids.loteNovo = await mk('Escola OFX Nova', new Date(Date.now() - 864e5));
    ids.loteVelho = await mk('Escola OFX Velha', new Date(Date.now() - 40 * 864e5));
  });
  after(async () => {
    const ms = [ids.recompra.id, ids.duas.id, ids.pres.id, ids.manual.id, ids.manualRecompra.id];
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms } } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: [ids.loteNovo.id, ids.loteVelho.id] } } });
    await prisma.loteEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.escolaEad.deleteMany({ where: { nome: { endsWith: ` ${s}` } } });
    await prisma.turma.deleteMany({ where: { cursoId: { in: [cursoOn.id, cursoPres.id] } } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-est-${s}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.deleteMany({ where: { id: { in: [cursoOn.id, cursoPres.id] } } });
    await prisma.$disconnect();
  });

  test('estornos extras: só o estorno de quem comprou de novo (online e presencial), um por matrícula', async () => {
    const extras = (await F.estornosExtras(prisma)).filter((x) => [ids.recompra.id, ids.duas.id, ids.pres.id, ids.manual.id].includes(x.m.id));
    const porPag = new Map(extras.map((x) => [x.pagamento.id, x]));
    assert.ok(porPag.has(ids.pAntigo.id), 'recompra do online');
    assert.ok(porPag.has(ids.pPres.id), 'recompra do presencial');
    assert.ok(!porPag.has(ids.pDuasVelho.id) && !porPag.has(ids.pDuasNovo.id), 'matrícula estornada conta pelo valor dela, não pelos pagamentos');
    assert.equal(extras.length, 2);
    assert.equal(porPag.get(ids.pAntigo.id).valor, 49.9);
    assert.equal(porPag.get(ids.pAntigo.id).tipo, 'estornado');
    const total = F.totalEstornado([ids.duas], extras);
    assert.equal(total, Math.round((40 + 49.9 + 200) * 100) / 100);
  });

  test('[revisão C1] estorno manual marca todas as tentativas: o total é o da matrícula, não 3×', async () => {
    const extras = (await F.estornosExtras(prisma)).filter((x) => x.m.id === ids.manual.id || x.m.id === ids.manualRecompra.id);
    assert.equal(extras.filter((x) => x.m.id === ids.manual.id).length, 0);
    assert.equal(extras.filter((x) => x.m.id === ids.manualRecompra.id).length, 1, 'recompra depois de estorno manual: um estorno, não um por tentativa');
    assert.equal(F.totalEstornado([ids.manual], extras.filter((x) => x.m.id === ids.manual.id)), 300);
  });

  test('OFX: lote recebido no período entra como crédito; fora do período não', async () => {
    const de = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const ate = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const l = await coletarLancamentosOfx(prisma, { de, ate });
    const novo = l.find((x) => x.fitid === `LOTE${ids.loteNovo.id.replace(/-/g, '')}`.slice(0, 32).toUpperCase());
    assert.ok(novo, 'lote recebido no período');
    assert.equal(novo.valor, 750);
    assert.equal(novo.tipoTrn, 'CREDIT');
    assert.match(novo.memo, new RegExp(`Lote: Escola OFX Nova ${s}`));
    assert.ok(!l.some((x) => x.fitid.startsWith('LOTE') && x.fitid.includes(ids.loteVelho.id.replace(/-/g, '').slice(0, 8).toUpperCase())));
  });
});
