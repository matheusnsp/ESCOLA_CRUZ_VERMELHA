// Painel → Escolas (etapa 6, só DEV): criar lote, recebido, vagas, apagar, filtro, arquivos. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('painel: escolas e lotes', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  require('../src/lib/email').enviarVagaLiberada = async () => {};
  require('../src/lib/email').enviarGestorEscola = async () => {};
  const sufixo = Date.now();
  const auditoria = [];
  let server; let painel; let curso; let co; let lote; let fCpf;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE painel lote ${sufixo}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      req.session = { usuarioId: null };
      Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV' } });
      next();
    });
    app.use(require('../src/routes/ead')({ requireDev: (req, res, next) => next(), auditar: async (req, acao) => { auditoria.push(acao); }, ADMIN_URL: '' }));
    await new Promise((r) => { server = app.listen(0, r); });
    painel = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const lotes = await prisma.loteEad.findMany({ where: { cursoOnlineId: co.id } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: lotes.map((l) => l.id) } } });
    await prisma.vagaLoteEad.deleteMany({ where: { loteId: { in: lotes.map((l) => l.id) } } });
    await prisma.loteEad.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await prisma.escolaEad.deleteMany({ where: { nome: { contains: `Painel ${sufixo}` } } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-pain-${sufixo}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });
  const get = async (url) => fetch(painel + url);
  const post = (url, corpo = {}) => fetch(painel + url, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const loc = (r) => decodeURIComponent(r.headers.get('location') || '');
  const form = (extra = {}) => ({
    escolaId: '', escolaNome: `Escola Painel ${sufixo}`, escolaCnpj: '', cursoOnlineId: co.id, vagas: '3', validoAte: '2027-12-31',
    valor: '1.200,00', forma: 'BOLETO', recebidoEm: '', observacao: 'Empenho 123',
    gestorNome: 'Gestora Painel', gestorEmail: `g-pain-${sufixo}@teste.local`, gestorCelular: '', gestorCpf: cpf(), ...extra,
  });

  test('o formulário abre; CNPJ inválido e vagas fora do limite ⇒ 400', async () => {
    assert.equal((await get('/ead/escolas/lote/novo')).status, 200);
    assert.equal((await post('/ead/escolas/lote/novo', form({ escolaCnpj: '11.111.111/1111-11' }))).status, 400);
    assert.equal((await post('/ead/escolas/lote/novo', form({ vagas: '0' }))).status, 400);
    assert.equal((await post('/ead/escolas/lote/novo', form({ vagas: '5001' }))).status, 400);
  });

  test('criar lote completo ⇒ vai para o lote; valor 1200; auditoria', async () => {
    const r = await post('/ead/escolas/lote/novo', form());
    assert.equal(r.status, 302);
    lote = await prisma.loteEad.findFirst({ where: { cursoOnlineId: co.id } });
    assert.match(loc(r), new RegExp(`/ead/escolas/lote/${lote.id}\\?ok=`));
    assert.equal(Number(lote.valor), 1200); assert.equal(lote.forma, 'BOLETO'); assert.equal(lote.recebidoEm, null);
    assert.equal(new Date(lote.validoAte).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), '2027-12-31');
  });

  test('lista e filtro "a receber"; marcar recebido e desfazer', async () => {
    assert.match(await (await get('/ead/escolas?filtro=areceber')).text(), new RegExp(`Escola Painel ${sufixo}`));
    await post(`/ead/escolas/lote/${lote.id}/recebido`, { recebidoEm: '2026-11-03' });
    assert.equal(new Date((await prisma.loteEad.findUnique({ where: { id: lote.id } })).recebidoEm).toISOString().slice(0, 10), '2026-11-03');
    assert.doesNotMatch(await (await get('/ead/escolas?filtro=areceber')).text(), new RegExp(`Escola Painel ${sufixo}`));
    await post(`/ead/escolas/lote/${lote.id}/desfazer-recebido`);
    assert.equal((await prisma.loteEad.findUnique({ where: { id: lote.id } })).recebidoEm, null);
  });

  test('funcionário pelo painel aparece com CPF inteiro; vagas abaixo das usadas e apagar com vaga recusam', async () => {
    fCpf = cpf();
    const r = await post(`/ead/escolas/lote/${lote.id}/funcionario`, { nome: 'Func Painel', email: `f-pain-${sufixo}@teste.local`, celular: '', cpf: fCpf });
    assert.match(loc(r), /ok=/);
    await post(`/ead/escolas/lote/${lote.id}/funcionario`, { nome: 'Func Dois', email: `f2-pain-${sufixo}@teste.local`, celular: '', cpf: cpf() });
    const html = await (await get(`/ead/escolas/lote/${lote.id}`)).text();
    assert.match(html, /Func Painel/); assert.match(html, new RegExp(`${fCpf.slice(0, 3)}\\.${fCpf.slice(3, 6)}\\.${fCpf.slice(6, 9)}-${fCpf.slice(9)}`));
    assert.match(loc(await post(`/ead/escolas/lote/${lote.id}/alterar`, { vagas: '1', validoAte: '2027-12-31', observacao: '' })), /erro=/);
    assert.match(loc(await post(`/ead/escolas/lote/${lote.id}/apagar`)), /erro=/);
    assert.equal(await prisma.loteEad.count({ where: { id: lote.id } }), 1);
  });

  test('gestor: adicionar e tirar (não deixa sem nenhum); convite trocar', async () => {
    await post(`/ead/escolas/lote/${lote.id}/gestor`, { nome: 'Segundo Gestor', email: `g2-pain-${sufixo}@teste.local`, celular: '', cpf: cpf() });
    const gs = await prisma.gestorEscolaEad.findMany({ where: { escolaId: lote.escolaId } });
    assert.equal(gs.length, 2);
    await post(`/ead/escolas/lote/${lote.id}/gestor/${gs[1].usuarioId}/remover`);
    const um = await prisma.gestorEscolaEad.findMany({ where: { escolaId: lote.escolaId } });
    assert.equal(um.length, 1);
    assert.match(loc(await post(`/ead/escolas/lote/${lote.id}/gestor/${um[0].usuarioId}/remover`)), /erro=/);
    const antes = (await prisma.loteEad.findUnique({ where: { id: lote.id } })).convite;
    await post(`/ead/escolas/lote/${lote.id}/convite/trocar`);
    assert.notEqual((await prisma.loteEad.findUnique({ where: { id: lote.id } })).convite, antes);
  });

  test('PDF e Excel baixam pelo painel; menu tem "Escolas"', async () => {
    const pdf = await get(`/ead/escolas/lote/${lote.id}/declaracao.pdf`);
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    const x = await get(`/ead/escolas/lote/${lote.id}/planilha.xlsx`);
    assert.equal(x.status, 200);
    assert.match(await (await get('/ead/escolas')).text(), /href="\/ead\/escolas"[^>]*>[\s\S]{0,80}Escolas/);
  });

  test('apagar lote sem vaga', async () => {
    const r = await post('/ead/escolas/lote/novo', form({ escolaNome: `Escola Vazia Painel ${sufixo}`, gestorEmail: `g3-pain-${sufixo}@teste.local`, gestorCpf: cpf() }));
    const id = loc(r).match(/lote\/([0-9a-f-]{36})/)[1];
    assert.match(loc(await post(`/ead/escolas/lote/${id}/apagar`)), /\/ead\/escolas\?ok=/);
    assert.equal(await prisma.loteEad.count({ where: { id } }), 0);
  });
});
