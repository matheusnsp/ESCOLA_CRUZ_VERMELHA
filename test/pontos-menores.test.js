// Pontos menores das revisões (2026-11-10): cupom "Tudo" gravado no presencial, PIX antigo de outro valor,
// limite de usos com inscrições pendentes e rodapé do e-book em página girada/recortada.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { PDFDocument, degrees } = require('pdf-lib');

function conteudo(buf) { const s = buf.toString('latin1'); let out = ''; const re = /stream\r?\n([\s\S]*?)endstream/g; let m; while ((m = re.exec(s))) { try { out += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) { out += m[1]; } } return out; }

test('rodapé do e-book: página girada recebe o texto girado; página recortada, dentro do recorte', async () => {
  const arq = require('../src/lib/ebook-arquivo');
  const d = await PDFDocument.create();
  d.addPage([400, 600]).setRotation(degrees(90));
  const p2 = d.addPage([400, 600]); p2.setCropBox(50, 80, 300, 400);
  const marcado = await arq.marcar(Buffer.from(await d.save()), 'Licenciado para Ana');
  const c = conteudo(marcado);
  // página girada 90°: o texto sai girado (matriz 0 1 -1 0), encostado na borda direita (a "de baixo" na tela)
  assert.match(c, /[\d.e-]+ 1 -1 [\d.e-]+ 39\d(\.\d+)? \d+(\.\d+)? (cm|Tm)/);
  // página recortada: y = 80 (base do recorte) + 10
  assert.match(c, /1 0 0 1 \d+(\.\d+)? 90 (cm|Tm)/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('cupom: "Tudo" no presencial, PIX antigo e limite de usos', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cupons = require('../src/lib/ead-cupom');
  const { calcularValores } = require('../src/lib/matricula');
  const s = String(Date.now()).slice(-7);
  let curso; let turma; const usuarios = []; const cupIds = []; const mats = [];
  const aluno = async (n) => { const u = await prisma.usuario.create({ data: { nome: 'Pm ' + n, email: `pm-${n}-${s}@teste.local`, papel: 'ALUNO' } }); usuarios.push(u.id); return u; };
  const cupom = async (codigo, extra) => { const c = await prisma.cupomEad.create({ data: { codigo: codigo + s, tipo: 'PERCENTUAL', valor: 20, criadoPor: 'teste', ...extra } }); cupIds.push(c.id); return c; };
  const matricula = async (u, dados, cp) => {
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 450, valorTaxaMatricula: 50, statusPagamento: 'PENDENTE', ...dados } });
    mats.push(m.id);
    if (cp) await prisma.cupomMatriculaEad.create({ data: { matriculaId: m.id, cupomId: cp.id, precoCheio: 500, desconto: 100, precoFinal: 400 } });
    return m;
  };
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Pm curso ${s}`, cargaHoraria: 8, precoAvista: 500, precoCheio: 600, valorParcela: 100, taxaMatricula: 50 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: new Date('2099-01-01'), vagas: 10, status: 'ABERTA' } });
  });
  after(async () => {
    await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: mats } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: mats } } });
    await prisma.matricula.deleteMany({ where: { id: { in: mats } } });
    await prisma.cupomEad.deleteMany({ where: { id: { in: cupIds } } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  });

  test('cupom "Tudo" gravado na inscrição presencial continua dando o desconto nas etapas', async () => {
    const tudo = await cupom('TUDO', { valeTudo: true });
    const u = await aluno('tudo');
    const m = await matricula(u, { plano: 'PARCELADO', valorCurso: 530, taxaConfirmada: true }, tudo);
    assert.equal(cupons.valeNoPresencial(tudo, curso), true);
    assert.equal(Number((await calcularValores(curso, 'PARCELADO', u.id, { matriculaId: m.id })).valorCurso), 500, '600 - 100 gravado');
  });

  test('PIX antigo de outro valor pago: a matrícula registra o valor pago e o cupom só fica se bater', async () => {
    const { aplicarStatus } = require('../src/lib/status-pagamento');
    const vinte = await cupom('VINTE', { cursoId: curso.id });
    const u = await aluno('pix');
    const m = await matricula(u, {}, vinte); // 400 + 50 = 450 com o cupom
    const antigo = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', metodo: 'PIX', valor: 550, status: 'PENDENTE', gateway: 'unicopag', gatewayRef: `pm-antigo-${s}` } });
    await aplicarStatus(antigo, { status: 'paid', payload: {} });
    const depois = await prisma.matricula.findUnique({ where: { id: m.id }, include: { cupomEad: true } });
    assert.equal(depois.statusPagamento, 'PAGO');
    assert.equal(Number(depois.valorCurso), 550, 'o que foi pago de verdade');
    assert.equal(depois.cupomEad, null, 'pagou o preço cheio: o cupom não foi usado');
  });

  test('limite de usos conta quem já pagou a taxa e ainda vai pagar o curso (não o próprio aluno)', async () => {
    const um = await cupom('UMUSO', { cursoId: curso.id, limiteUsos: 1 });
    const dono = await aluno('dono');
    await matricula(dono, { plano: 'PARCELADO', valorCurso: 530, taxaConfirmada: true }, um);
    const outro = await aluno('outro');
    assert.equal((await cupons.validarCupom('UMUSO' + s, curso, { presencial: true, preco: 500, alunoId: outro.id })).erro, cupons.MSG.esgotado);
    assert.ok(!(await cupons.validarCupom('UMUSO' + s, curso, { presencial: true, preco: 500, alunoId: dono.id })).erro, 'quem já reservou continua');
  });
});
