// Cupom no curso presencial (2026-11-09): validação, formulário, lista e valores com desconto. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('aba Cupons também no modo Presencial do painel', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'header.ejs'), 'utf8');
  assert.equal((h.match(/href="\/ead\/cupons"/g) || []).length, 2);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('cupom presencial', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cupons = require('../src/lib/ead-cupom');
  const s = String(Date.now()).slice(-7);
  let cursoA; let cursoB; let co; const ids = [];
  const cupom = async (codigo, extra) => { const c = await prisma.cupomEad.create({ data: { codigo: codigo + s, tipo: 'PERCENTUAL', valor: 20, criadoPor: 'teste', ...extra } }); ids.push(c.id); return c; };
  before(async () => {
    cursoA = await prisma.curso.create({ data: { nome: `Presencial A ${s}`, cargaHoraria: 8, precoAvista: 500, precoCheio: 600, valorParcela: 100 } });
    cursoB = await prisma.curso.create({ data: { nome: `Presencial B ${s}`, cargaHoraria: 8, precoAvista: 300, precoCheio: 300, valorParcela: 100 } });
    const cOn = await prisma.curso.create({ data: { nome: `Online C ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: cOn.id, precoOnline: 100 } });
    await cupom('PRA', { cursoId: cursoA.id });
    await cupom('TODP', { todosPresenciais: true });
    await cupom('GERAL', {});
  });
  after(async () => {
    await prisma.cupomEad.deleteMany({ where: { id: { in: ids } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.deleteMany({ where: { id: { in: [cursoA.id, cursoB.id, co.cursoId] } } });
  });

  test('validarCupom presencial: curso certo, todos os presenciais, recusas', async () => {
    const v = await cupons.validarCupom('PRA' + s, cursoA, { presencial: true, preco: 500 });
    assert.equal(v.precoFinal, 400); assert.equal(v.desconto, 100);
    assert.equal((await cupons.validarCupom('PRA' + s, cursoB, { presencial: true, preco: 300 })).erro, cupons.MSG.outroCurso);
    assert.equal((await cupons.validarCupom('TODP' + s, cursoB, { presencial: true, preco: 300 })).precoFinal, 240);
    assert.equal((await cupons.validarCupom('GERAL' + s, cursoA, { presencial: true, preco: 500 })).erro, cupons.MSG.outroCurso, 'cupom "todos" antigo não vale no presencial');
    assert.equal((await cupons.validarCupom('PRA' + s, co)).erro, cupons.MSG.outroCurso, 'presencial não vale no online');
    assert.equal((await cupons.validarCupom('TODP' + s, co)).erro, cupons.MSG.outroCurso);
    assert.equal((await cupons.validarCupom('GERAL' + s, co)).precoFinal, 80, 'o geral continua valendo no online');
  });

  test('calcularValores: sem cupom igual a hoje; com cupom só o curso desce; gravado na matrícula; de outro curso não', async () => {
    const { calcularValores } = require('../src/lib/matricula');
    const sem = await calcularValores(cursoA, 'A_VISTA', null);
    const pra = await prisma.cupomEad.findUnique({ where: { codigo: 'PRA' + s } });
    const com = await calcularValores(cursoA, 'A_VISTA', null, { cupom: pra });
    assert.equal(Number(com.valorCurso), Number(sem.valorCurso) * 0.8);
    assert.equal(Number(com.valorTaxaMatricula), Number(sem.valorTaxaMatricula), 'taxa não muda');
    assert.equal(Number(com.total), Number(com.valorCurso) + Number(com.valorTaxaMatricula));
    assert.equal(Number(com.desconto), Number(sem.valorCurso) * 0.2);
    const parc = await calcularValores(cursoA, 'PARCELADO', null, { cupom: pra });
    assert.equal(Number(parc.valorCurso), 480, 'no parcelado o desconto é sobre o preço cheio');
    // gravado numa matrícula
    const turma = await prisma.turma.create({ data: { cursoId: cursoA.id, inicioPrevisto: new Date('2099-01-01'), vagas: 10 } });
    const u = await prisma.usuario.create({ data: { nome: 'Cupom Gravado', email: `cupom-gravado-${s}@teste.local` } });
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 400, statusPagamento: 'PENDENTE' } });
    await prisma.cupomMatriculaEad.create({ data: { matriculaId: m.id, cupomId: pra.id, precoCheio: 500, desconto: 100, precoFinal: 400 } });
    try {
      assert.equal(Number((await calcularValores(cursoA, 'A_VISTA', u.id, { matriculaId: m.id })).valorCurso), 400);
      // cupom desativado/vencido depois de gravado: o desconto já concedido continua
      await prisma.cupomEad.update({ where: { id: pra.id }, data: { ativo: false, validoAte: new Date('2020-01-01') } });
      assert.equal(Number((await calcularValores(cursoA, 'A_VISTA', u.id, { matriculaId: m.id })).valorCurso), 400);
      // transferida para outro curso: o cupom do curso A não vale no B
      assert.equal(Number((await calcularValores(cursoB, 'A_VISTA', u.id, { matriculaId: m.id })).valorCurso), 300);
    } finally {
      await prisma.cupomEad.update({ where: { id: pra.id }, data: { ativo: true, validoAte: null } });
      await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: m.id } });
      await prisma.matricula.delete({ where: { id: m.id } });
      await prisma.turma.delete({ where: { id: turma.id } });
      await prisma.usuario.delete({ where: { id: u.id } });
    }
  });

  test('chamadores com matrícula passam matriculaId', () => {
    const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const cursos = ler('src/routes/cursos.js');
    assert.ok((cursos.match(/calcularValores\([^;]*matriculaId: matricula\.id/g) || []).length >= 6, 'routes/cursos.js');
    assert.match(ler('src/lib/lembretes.js'), /calcularValores\(curso, 'PARCELADO', matricula\.alunoId, \{ matriculaId: matricula\.id \}\)/);
    assert.match(ler('src/lib/matricula-rapida.js'), /m\.alunoId, \{ matriculaId: m\.id \}\)/);
    assert.match(ler('src/routes/admin.js'), /calcularValores\(destino\.curso, m\.plano, m\.alunoId, \{ matriculaId: m\.id \}\)/);
  });

  test('formulário: alvo presencial grava cursoId; "presenciais" grava todosPresenciais; lista com rótulos', async () => {
    const a = cupons.lerDados({ codigo: 'X' + s, tipo: 'PERCENTUAL', valor: '10', alvo: `presencial:${cursoA.id}` });
    assert.equal(a.dados.cursoId, cursoA.id); assert.equal(a.dados.todosPresenciais, false); assert.equal(a.dados.cursoOnlineId, null);
    const b = cupons.lerDados({ codigo: 'X' + s, tipo: 'PERCENTUAL', valor: '10', alvo: 'presenciais' });
    assert.equal(b.dados.todosPresenciais, true); assert.equal(b.dados.cursoId, null);
    const lista = await cupons.listarCupons({});
    assert.equal(lista.find((c) => c.codigo === 'PRA' + s).curso, `Presencial: ${cursoA.nome}`);
    assert.equal(lista.find((c) => c.codigo === 'TODP' + s).curso, 'Todos os cursos presenciais');
  });
});

test('[revisão C1] todo formulário de pagamento da inscrição leva o cupom (à vista, parcelado, presencial, passaporte)', () => {
  const v = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'inscrever.ejs'), 'utf8');
  const forms = v.match(/<form method="POST" action="\/inscrever\/<%= turma\.id %>" novalidate[^>]*>\s*<input type="hidden" name="cupom"/g) || [];
  assert.equal(forms.length, (v.match(/<form method="POST" action="\/inscrever\/<%= turma\.id %>" novalidate/g) || []).length);
  assert.equal(forms.length, 4);
});
