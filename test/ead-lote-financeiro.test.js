// Dinheiro dos lotes (etapa 6): somasDosLotes, relatório e o uso no admin. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cpf = require('./helpers/cpf');

test('admin.js usa somasDosLotes no Financeiro e no Painel', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.ok((src.match(/somasDosLotes\(/g) || []).length >= 2);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('somas dos lotes', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const L = require('../src/lib/ead-lote');
  const relatorio = require('../src/lib/relatorio');
  require('../src/lib/email').enviarGestorEscola = async () => {};
  const sufixo = Date.now();
  let curso; let co; let base; const ls = {};
  const inicioMes = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 8)}01T00:00:00-03:00`);
  const doMesPassado = new Date(inicioMes.getTime() - 5 * 864e5);
  const desteMes = new Date(Math.max(inicioMes.getTime() + 3600e3, Date.now() - 3600e3));

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Fin ${sufixo}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    base = await L.somasDosLotes({ inicioMes });
    const g = { nome: 'Gestor Fin', email: `g-fin-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    const mk = async (nome, valor, recebidoEm, vagas) => (await L.criarLote({ escola: { nome: `${nome} ${sufixo}` }, cursoOnlineId: co.id, vagas, validoAte: new Date(Date.now() + 864e5), valor, forma: 'PIX', recebidoEm, gestor: g, atorId: 'dev' })).lote;
    ls.mes = await mk('Escola Mês', 1000, desteMes, 10);
    ls.passado = await mk('Escola Passado', 400, doMesPassado, 4);
    ls.aReceber = await mk('Escola Deve', 250.5, null, 2);
  });
  after(async () => {
    const ids = Object.values(ls).map((l) => l.id);
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: ids } } });
    await prisma.loteEad.deleteMany({ where: { id: { in: ids } } });
    await prisma.escolaEad.deleteMany({ where: { nome: { endsWith: String(sufixo) } } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-fin-${sufixo}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('totais, mês e rótulos', async () => {
    const s = await L.somasDosLotes({ inicioMes });
    assert.equal(Math.round((s.recebidoTotal - base.recebidoTotal) * 100) / 100, 1400);
    assert.equal(Math.round((s.recebidoMes - base.recebidoMes) * 100) / 100, 1000);
    assert.equal(Math.round((s.aReceberTotal - base.aReceberTotal) * 100) / 100, 250.5);
    assert.ok(s.linhas.some((x) => x.tipo === 'lote' && x.rotulo === `Lote: Escola Mês ${sufixo} · Curso Fin ${sufixo} · 10 vagas` && x.valor === 1000));
    assert.ok(s.linhas.some((x) => x.tipo === 'lote_a_receber' && x.rotulo === `Lote: Escola Deve ${sufixo} (a receber)`));
  });

  test('[Review Focus] recebido → desfazer → recebido noutra data: conta uma vez, no mês da data atual', async () => {
    await L.alterarLote(ls.mes.id, { recebidoEm: null }, 'dev');
    let s = await L.somasDosLotes({ inicioMes });
    assert.equal(Math.round((s.recebidoTotal - base.recebidoTotal) * 100) / 100, 400);
    assert.equal(Math.round((s.aReceberTotal - base.aReceberTotal) * 100) / 100, 1250.5);
    await L.alterarLote(ls.mes.id, { recebidoEm: doMesPassado }, 'dev');
    s = await L.somasDosLotes({ inicioMes });
    assert.equal(Math.round((s.recebidoTotal - base.recebidoTotal) * 100) / 100, 1400);
    assert.equal(Math.round((s.recebidoMes - base.recebidoMes) * 100) / 100, 0);
    await L.alterarLote(ls.mes.id, { recebidoEm: desteMes }, 'dev');
  });

  test('consulta falhando: zeros e lista vazia (o Financeiro abre igual)', async () => {
    const original = prisma.loteEad.findMany;
    prisma.loteEad.findMany = async () => { throw new Error('relation "LoteEad" does not exist'); };
    try {
      assert.deepEqual(await L.somasDosLotes({ inicioMes }), { recebidoTotal: 0, recebidoMes: 0, aReceberTotal: 0, linhas: [] });
    } finally { prisma.loteEad.findMany = original; }
  });

  test('relatório: total recebido soma os lotes e traz a lista', async () => {
    const d = await relatorio.coletarDadosRelatorio(prisma);
    const semLotes = d.financeiro.totais.totalRecebido - d.financeiro.totais.totalLotes;
    assert.ok(d.financeiro.totais.totalLotes >= 1400);
    assert.ok(Math.abs(d.financeiro.totais.totalRecebido - (semLotes + d.financeiro.totais.totalLotes)) < 0.001);
    assert.ok(d.financeiro.lotes.some((x) => x.rotulo.startsWith(`Lote: Escola Mês ${sufixo}`)));
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await relatorio.gerarExcel(d));
    assert.ok(wb.getWorksheet('Lotes de escolas'));
  });
});
