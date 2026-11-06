// Declaração de capacitação (PDF) e planilha do lote (etapa 6). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');
const textoDoPdf = require('./helpers/texto-pdf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('declaração e planilha do lote', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const L = require('../src/lib/ead-lote');
  const cert = require('../src/lib/certificado');
  const { gerarDeclaracao, gerarPlanilhaLote } = require('../src/lib/ead-lote-declaracao');
  require('../src/lib/email').enviarVagaLiberada = async () => {};
  require('../src/lib/email').enviarGestorEscola = async () => {};
  const sufixo = Date.now();
  let curso; let co; let lote; let loteVazio; let gestor; let joao; let maria; let removida; let server; let site;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Primeiros Socorros Decl ${sufixo}`, cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    const g = { nome: 'Gestora Decl', email: `g-decl-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    lote = (await L.criarLote({ escola: { nome: `Escola Conceição D'Ávila ${sufixo}`, cnpj: '11.222.333/0001-81' }, cursoOnlineId: co.id, vagas: 5, validoAte: new Date(Date.now() + 30 * 864e5), valor: 500, forma: 'EMPENHO', gestor: g, atorId: 'dev' })).lote;
    gestor = await prisma.usuario.findFirst({ where: { email: g.email } });
    loteVazio = (await L.criarLote({ escola: { id: lote.escolaId }, cursoOnlineId: co.id, vagas: 1, validoAte: new Date(Date.now() + 30 * 864e5), valor: 0, forma: 'OUTRO', gestor: g, atorId: 'dev' })).lote;
    joao = { nome: "João D'Ávila Conceição", email: `joao-decl-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    maria = { nome: 'Maria Sem Concluir', email: `maria-decl-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    removida = { nome: 'Rita Retirada', email: `rita-decl-${sufixo}@teste.local`, celular: '', cpf: cpf() };
    for (const pz of [joao, maria, removida]) pz.u = (await L.cadastrarFuncionario(lote.id, pz, { atorId: 'g' })).usuario;
    // João concluiu (com número no Livro)
    const ac = await prisma.alunoCursoEad.create({ data: { usuarioId: joao.u.id, cursoOnlineId: co.id, concluidoEm: new Date('2026-10-20T15:00:00Z') } });
    await cert.numerarEad(ac.id);
    await prisma.logAuditoria.create({ data: { id: `cert-redacao-${ac.id}`, atorId: 'SISTEMA', acao: 'CERTIFICADO_REDACAO', alvoTipo: 'AlunoCursoEad', alvoId: ac.id, detalhe: { codigo: 'WXYZ-2345' } } });
    const vr = await prisma.vagaLoteEad.findFirst({ where: { usuarioId: removida.u.id } });
    await L.removerVaga(vr.id, 'g');

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/ead-escola'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const acs = await prisma.alunoCursoEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: [lote.id, loteVazio.id, ...acs.map((a) => a.id)] } } });
    for (const l of [lote, loteVazio]) { await prisma.vagaLoteEad.deleteMany({ where: { loteId: l.id } }); await prisma.loteEad.delete({ where: { id: l.id } }); }
    await prisma.escolaEad.delete({ where: { id: lote.escolaId } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-decl-${sufixo}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('PDF: texto da Lei, escola e CNPJ, só concluintes, CPF mascarado, Livro, observação', async () => {
    const { buffer, nomeArquivo } = await gerarDeclaracao(lote.id, { compress: false });
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.match(nomeArquivo, /^declaracao-escola-conceicao-d-avila-\d+\.pdf$/);
    const t = textoDoPdf(buffer);
    assert.match(t, /Lei 13\.722\/2018/);
    assert.match(t, new RegExp(`Escola Conceição D'Ávila ${sufixo}`));
    assert.match(t, /11\.222\.333\/0001-81/);
    assert.match(t, /João D'Ávila Conceição/); // [Review Focus] acento e apóstrofo
    assert.match(t, new RegExp(`\\*\\*\\*\\.${joao.cpf.slice(3, 6)}\\.${joao.cpf.slice(6, 9)}-\\*\\*`));
    assert.doesNotMatch(t, new RegExp(joao.cpf));
    assert.match(t, /WXYZ-2345/);
    assert.doesNotMatch(t, /Maria Sem Concluir/); assert.doesNotMatch(t, /Rita Retirada/);
    assert.match(t, /Capacitação teórica, sem prática em manequim\./);
  });

  test('PDF sem concluintes: frase de nenhum concluinte', async () => {
    const t = textoDoPdf((await gerarDeclaracao(loteVazio.id, { compress: false })).buffer);
    assert.match(t, /Nenhum funcionário concluiu o curso até esta data/);
  });

  test('Excel: aba Funcionários, cabeçalho e removida marcada', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const { buffer, nomeArquivo } = await gerarPlanilhaLote(lote.id);
    await wb.xlsx.load(buffer);
    assert.match(nomeArquivo, /\.xlsx$/);
    const ws = wb.getWorksheet('Funcionários');
    assert.deepEqual(ws.getRow(1).values.slice(1), ['Nome', 'E-mail', 'CPF', 'Entrou em', 'Como', '% concluído', 'Concluiu em', 'Livro', 'Registro', 'Código']);
    assert.equal(ws.rowCount, 4);
    const linhas = [2, 3, 4].map((i) => ws.getRow(i).values.slice(1));
    const rita = linhas.find((l) => l[0] === 'Rita Retirada');
    assert.match(String(rita[4]), /retirad/i);
    const jo = linhas.find((l) => l[0] === "João D'Ávila Conceição");
    assert.equal(jo[9], 'WXYZ-2345'); assert.match(String(jo[2]), /^\*\*\*\./);
  });

  test('rotas: gestor baixa como anexo; lote de outra escola ⇒ 404', async () => {
    const r = await fetch(`${site}/minha-escola/lote/${lote.id}/declaracao.pdf`, { headers: { 'x-teste-usuario': gestor.id } });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /^attachment; filename="declaracao-/);
    const x = await fetch(`${site}/minha-escola/lote/${lote.id}/planilha.xlsx`, { headers: { 'x-teste-usuario': gestor.id } });
    assert.equal(x.status, 200); assert.match(x.headers.get('content-disposition'), /^attachment; filename=".+\.xlsx"$/);
    assert.equal((await fetch(`${site}/minha-escola/lote/${lote.id}/declaracao.pdf`, { headers: { 'x-teste-usuario': joao.u.id } })).status, 404);
  });
});
