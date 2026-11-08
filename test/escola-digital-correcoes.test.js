// Escola Digital (2026-11), Task 3 (vistoria B4, B8, P10, T1). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const cpf = require('./helpers/cpf');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('correções da vistoria (estorno, desativar, painel, certificado de teste)', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const email = require('../src/lib/email');
  email.enviarCursoOnlineLiberado = async () => {};
  email.enviarCertificadoEadPronto = async () => {};
  const { aplicarStatus } = require('../src/lib/status-pagamento');
  const { acessoPago } = require('../src/lib/ead-acesso');
  const { turmaOnline } = require('../src/lib/turma-online');
  const cert = require('../src/lib/certificado');
  const s = String(Date.now()).slice(-7);
  const cos = []; const usuarios = []; const escolas = [];
  let painel; let site;

  const novoCurso = async (nome, extra = {}) => {
    const c = await prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    const co = await prisma.cursoOnline.create({ data: { cursoId: c.id, precoOnline: 100, ...extra } });
    cos.push(co.id);
    return co;
  };
  const novoAluno = async (nome) => {
    const u = await prisma.usuario.create({ data: { nome, email: `cor-${usuarios.length}-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    usuarios.push(u.id);
    return u;
  };

  before(async () => {
    painel = await ouvir(montarPainel(`dev-cor-${s}`));
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.documentoAluno = () => null;
    app.use((req, res, next) => { req.session = { usuarioId: req.get('x-u'), papel: 'ALUNO' }; Object.assign(res.locals, { csrfToken: 'x', isAdmin: false }); next(); });
    app.use(require('../src/routes/ead-teste'));
    site = await ouvir(app);
  });
  after(async () => {
    painel.server.close(); site.server.close();
    const cursoIds = (await prisma.cursoOnline.findMany({ where: { id: { in: cos } }, select: { cursoId: true } })).map((c) => c.cursoId);
    const turmas = await prisma.turma.findMany({ where: { cursoId: { in: cursoIds } }, select: { id: true } });
    const ms = await prisma.matricula.findMany({ where: { alunoId: { in: usuarios } }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    await prisma.turma.deleteMany({ where: { id: { in: turmas.map((t) => t.id) } } });
    const acs = await prisma.alunoCursoEad.findMany({ where: { cursoOnlineId: { in: cos } }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: acs.map((a) => a.id) } } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: { in: cos } } });
    await prisma.loteEad.deleteMany({ where: { cursoOnlineId: { in: cos } } });
    await prisma.escolaEad.deleteMany({ where: { id: { in: escolas } } });
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'ead-teste:' }, valor: { contains: s } } }).catch(() => {});
    await apagarCursosOnline(prisma, cos);
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.$disconnect();
  });

  async function compraComDoisPagamentos() {
    const co = await novoCurso('Curso Estorno', { publicado: true, somenteOnline: true });
    const u = await novoAluno('Aluno Estorno');
    const turma = await turmaOnline(co);
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 100, valorTaxaMatricula: 0, statusPagamento: 'PENDENTE' } });
    const pix = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: 100, status: 'PENDENTE', gatewayRef: `cor-${s}-pix-${m.id.slice(0, 4)}` } });
    const cc = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'CREDITO', valor: 100, status: 'PENDENTE', gatewayRef: `cor-${s}-cc-${m.id.slice(0, 4)}` } });
    return { co, u, m, pix, cc };
  }

  test('estornar um de dois pagamentos pagos mantém o acesso', async () => {
    const { co, u, pix, cc } = await compraComDoisPagamentos();
    await aplicarStatus(cc, { status: 'paid', payload: {}, origem: 'webhook' });
    await aplicarStatus(await prisma.pagamento.findUnique({ where: { id: pix.id } }), { status: 'paid', payload: {}, origem: 'webhook' });
    await aplicarStatus(await prisma.pagamento.findUnique({ where: { id: pix.id } }), { status: 'refunded', payload: {}, origem: 'webhook' });
    assert.equal((await acessoPago(u.id, co)).liberado, true);
  });

  test('estornar o único pagamento fecha o acesso', async () => {
    const { co, u, cc } = await compraComDoisPagamentos();
    await aplicarStatus(cc, { status: 'paid', payload: {}, origem: 'webhook' });
    await aplicarStatus(await prisma.pagamento.findUnique({ where: { id: cc.id } }), { status: 'refunded', payload: {}, origem: 'webhook' });
    assert.equal((await acessoPago(u.id, co)).liberado, false);
  });

  test('desativar EAD de curso com cupom mostra mensagem (sem erro 500)', async () => {
    const co = await novoCurso('Curso Desativar Cupom');
    await prisma.cupomEad.create({ data: { codigo: `DESAT${s}`, tipo: 'VALOR', valor: 5, cursoOnlineId: co.id, criadoPor: 'teste' } });
    const r = await fetch(`${painel.url}/ead/curso/${co.id}/desativar`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(decodeURIComponent(r.headers.get('location')), /cupom/i);
    assert.ok(await prisma.cursoOnline.findUnique({ where: { id: co.id } }), 'curso continua');
  });

  test('desativar EAD de curso com lote de escola mostra mensagem', async () => {
    const co = await novoCurso('Curso Desativar Lote');
    const e = await prisma.escolaEad.create({ data: { nome: `Escola Cor ${s}` } }); escolas.push(e.id);
    await prisma.loteEad.create({ data: { escolaId: e.id, cursoOnlineId: co.id, vagas: 2, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'PIX', criadoPor: 'teste' } });
    const r = await fetch(`${painel.url}/ead/curso/${co.id}/desativar`, { method: 'POST', redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(decodeURIComponent(r.headers.get('location')), /escola/i);
  });

  test('detalhe do aluno que veio de escola: origem "Escola:" e início na vaga', async () => {
    const rel = require('../src/lib/ead-relatorios');
    const co = await novoCurso('Curso Detalhe Lote');
    const e = await prisma.escolaEad.create({ data: { nome: `Escola Detalhe ${s}` } }); escolas.push(e.id);
    const lote = await prisma.loteEad.create({ data: { escolaId: e.id, cursoOnlineId: co.id, vagas: 2, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'PIX', criadoPor: 'teste' } });
    const u = await novoAluno('Funcionaria Lote');
    const vaga = await prisma.vagaLoteEad.create({ data: { loteId: lote.id, usuarioId: u.id, origem: 'GESTOR', criadoEm: new Date(Date.now() - 10 * 864e5) } });
    const ac = await prisma.alunoCursoEad.create({ data: { usuarioId: u.id, cursoOnlineId: co.id } });
    const d = await rel.detalheDoAluno(co.id, ac.id);
    assert.equal(d.origem, `Escola: Escola Detalhe ${s}`);
    assert.equal(d.fase, 'Livre', 'os 7 dias contam da vaga (10 dias atrás)');
    assert.ok(vaga);
  });

  test('concluir pelo link de teste não reserva número oficial; o certificado sai como TESTE', async () => {
    const eadTeste = require('../src/lib/ead-teste');
    const co = await novoCurso('Curso Cert Teste');
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela única' }] } }, include: { telas: true } });
    const codigo = await eadTeste.gerarCodigo(co.id);
    const u = await novoAluno('Testador Cert');
    const r = await fetch(`${site.url}/ead-teste/${codigo}/tela/${t.telas[0].id}`, { headers: { 'x-u': u.id } });
    assert.equal(r.status, 200);
    await fetch(`${site.url}/ead-teste/${codigo}`, { headers: { 'x-u': u.id } }); // a capa conclui o curso
    await new Promise((x) => setTimeout(x, 300));
    const ac = await prisma.alunoCursoEad.findFirst({ where: { usuarioId: u.id, cursoOnlineId: co.id } });
    assert.ok(ac.concluidoEm, 'curso concluído');
    assert.equal(await cert.lerNumero(ac.id), null, 'sem Livro/Registro');
    const c = await (await fetch(`${site.url}/ead-teste/${codigo}/certificado`, { headers: { 'x-u': u.id } })).text();
    assert.match(c, /TESTE — sem validade/);
    assert.equal(await cert.lerNumero(ac.id), null, 'abrir o certificado de teste também não numera');
    await eadTeste.desligar(co.id);
  });
});
