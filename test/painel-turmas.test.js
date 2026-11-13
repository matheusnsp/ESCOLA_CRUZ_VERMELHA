// 2026-11-13: resumo da turma, lista com Abrir e telas filhas com "Voltar à turma" (Task 9 do plano
// docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ejs = require('ejs');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const V = (f) => path.join(__dirname, '..', 'src', 'views', 'admin', f);

function montar(perms) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.locals.asset = require('../src/lib/assets').asset;
  app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
  app.locals.rotuloTurma = (s) => ({ ENCERRADA: 'CONCLUÍDA' }[s] || s);
  app.use(express.urlencoded({ extended: true }));
  const pode = (p) => perms.includes(p);
  app.use((req, res, next) => { req.session = { usuarioId: 'teste-turmas' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'X', pode, usuario: { nome: 'T' } }); next(); });
  app.use(require('../src/routes/painel-turmas')({ requirePermissao: (...ps) => (q, r, n) => (ps.some(pode) ? n() : r.status(403).send('403')), auditar: async () => {} }));
  return new Promise((r) => { const s = app.listen(0, () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
}

describe('resumo da turma', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const sfx = String(Date.now()).slice(-7);
  let curso; let comAlunos; let vazia; let aluno; let srv; let leitura;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Resumo Turma ${sfx}`, cargaHoraria: 8, precoAvista: 100, precoCheio: 100, valorParcela: 100 } });
    const fut = (d) => new Date(Date.now() + d * 86400000);
    comAlunos = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: fut(10), vagas: 30, minimoAlunos: 15, status: 'ABERTA', aulas: { create: [{ data: fut(10), horario: '18:00 – 22:00' }, { data: fut(12), horario: '18:00 – 22:00' }] } } });
    vazia = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: fut(40), vagas: 30, minimoAlunos: 0, status: 'ABERTA' } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluna Resumo', email: `aluna-resumo-${sfx}@teste.local`, papel: 'ALUNO' } });
    await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: comAlunos.id, plano: 'A_VISTA', forma: 'PIX', taxaConfirmada: true, statusPagamento: 'PENDENTE', valorCurso: 100, valorTaxaMatricula: 10 } });
    srv = await montar(['turmas:gerenciar', 'aluno:gerenciar']);
    leitura = await montar(['painel:leitura']);
  });
  after(async () => {
    srv.s.close(); leitura.s.close();
    await prisma.matricula.deleteMany({ where: { alunoId: aluno.id } });
    await prisma.usuario.delete({ where: { id: aluno.id } });
    await prisma.aulaData.deleteMany({ where: { turmaId: { in: [comAlunos.id, vazia.id] } } });
    await prisma.turma.deleteMany({ where: { id: { in: [comAlunos.id, vazia.id] } } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  test('cartões, próxima mudança automática e pendentes', async () => {
    const html = await (await fetch(`${srv.url}/turmas/${comAlunos.id}`)).text();
    for (const t of ['Dados da turma', 'Alunos', 'Mensagem de boas-vindas', 'Notas', 'QR da pesquisa', 'Certificados']) assert.match(html, new RegExp(t));
    for (const u of [`/turmas/${comAlunos.id}/editar`, `/alunos\\?turma=${comAlunos.id}`, `/turmas/${comAlunos.id}/boas-vindas`, `/turmas/${comAlunos.id}/notas`, `/turmas/${comAlunos.id}/pesquisa-qr`, `/turmas/${comAlunos.id}/certificados`]) assert.match(html, new RegExp(`href="${u}"`));
    assert.match(html, /vira Confirmada sozinha à 00:00 de \d\d\/\d\d/);
    assert.match(html, /1 com pagamento pendente/);
    assert.match(html, /<button[^>]*class="adm-btn-perigo"[^>]*disabled/);
  });

  test('sem alunos: excluir habilitado com confirmação', async () => {
    const html = await (await fetch(`${srv.url}/turmas/${vazia.id}`)).text();
    assert.match(html, /action="\/turmas\/[^"]+\/excluir"[^>]*data-confirmar=/);
    assert.match(html, /Falta: Aulas/);
  });

  test('só leitura: 403', async () => {
    assert.equal((await fetch(`${leitura.url}/turmas/${comAlunos.id}`)).status, 403);
  });
});

test('lista de turmas: só Abrir (para quem edita) e busca pelo curso', async () => {
  const locais = (pode) => ({ ativo: 'turmas', modoPainel: 'presencial', admPapel: 'X', csrfToken: 'x', usuario: { nome: 'T' }, asset: (u) => u, montarMenu: require('../src/lib/menu-painel').montarMenu, rotuloTurma: (s) => s, pode, flash: null, erro: null, busca: 'soco', statusTurma: [] });
  const t = { id: '22222222-2222-2222-2222-222222222222', inicioPrevisto: new Date(Date.now() + 5 * 86400000), vagas: 30, minimoAlunos: 15, status: 'ABERTA', curso: { nome: 'Socorrista' }, aulas: [], _count: { matriculas: 3 } };
  const abas = { 'por-comecar': [t], andamento: [], congeladas: [], concluidas: [], canceladas: [] };
  const html = await ejs.renderFile(V('turmas.ejs'), { ...locais((p) => p === 'turmas:gerenciar'), turmas: [t], abas, aba: 'por-comecar' });
  assert.match(html, /href="\/turmas\/22222222-2222-2222-2222-222222222222"[^>]*>\s*Abrir/);
  assert.doesNotMatch(html, /\/notas"|\/pesquisa-qr"|\/excluir"|\/editar"/, 'ações saem da linha');
  assert.match(html, /name="q"[^>]*value="soco"/);
  const leitura = await ejs.renderFile(V('turmas.ejs'), { ...locais((p) => p === 'painel:leitura'), turmas: [t], abas, aba: 'por-comecar' });
  assert.doesNotMatch(leitura, />\s*Abrir/);
  const { filtrarPorCurso } = require('../src/routes/painel-turmas');
  assert.deepEqual(filtrarPorCurso([t, { ...t, curso: { nome: 'Cuidador de Idosos' } }], 'SOCÓ').map((x) => x.curso.nome), ['Socorrista']);
});

test('telas filhas da turma e o formulário voltam para o resumo', () => {
  for (const f of ['turma-notas.ejs', 'turma-boas-vindas.ejs', 'turma-pesquisa-qr.ejs', 'turma-certificados.ejs']) {
    assert.match(fs.readFileSync(V(f), 'utf8'), /href="\/turmas\/<%= *[a-zA-Z.]+id *%>"[^>]*>← Voltar à turma/, f);
  }
  const form = fs.readFileSync(V('turma-form.ejs'), 'utf8');
  for (const t of ['Quando', 'Vagas', 'Situação', 'Instrutor']) assert.match(form, new RegExp(`<h2 class="adm-form-secao full"[^>]*>[^<]*<i[^>]*></i> ${t}`), t);
  assert.match(form, /data-gerar-aulas/);
  assert.match(form, /include\('header', \{ ativo: \(turma && turma\.id\) \? 'turmas' : 'turma-nova' \}\)/, 'Nova turma marca o item Nova turma no menu');
  assert.match(form, /js\/gerar-aulas\.js/);
  assert.doesNotMatch(form, /<script>\s*document\.addEventListener/, 'script das aulas foi para js/gerar-aulas.js');
});

let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }
test('formulário: Gerar aulas cria as linhas; Adicionar aula repete o horário', { skip: chromium ? false : 'sem Playwright' }, async () => {
  const html = await ejs.renderFile(V('turma-form.ejs'), {
    ativo: 'turma-nova', modoPainel: 'presencial', admPapel: 'X', csrfToken: 'x', usuario: { nome: 'T' }, asset: (u) => u,
    montarMenu: require('../src/lib/menu-painel').montarMenu, rotuloTurma: (s) => s, pode: () => true,
    turma: null, aulas: [], cursos: [{ id: 'c1', nome: 'Socorrista' }], statusTurma: ['ABERTA', 'CONFIRMADA'], erro: null,
  });
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    p.on('dialog', (d) => d.accept());
    await p.setContent(html.replace(/<script src="[^"]*gerar-aulas\.js"><\/script>/, ''));
    await p.addScriptTag({ path: path.join(__dirname, '..', 'src', 'public', 'js', 'gerar-aulas.js') });
    await p.fill('[name=inicioPrevisto]', '2026-12-01');
    await p.check('.adm-dias input[value="2"]', { force: true });
    await p.check('.adm-dias input[value="4"]', { force: true });
    await p.fill('.gerar-aulas-horario', '18h às 22h');
    await p.fill('.gerar-aulas-ate', '2026-12-17');
    await p.click('.gerar-aulas-bt');
    const datas = await p.$$eval('#aulas-lista input[type=date]', (l) => l.map((e) => e.value));
    assert.deepEqual(datas, ['2026-12-01', '2026-12-03', '2026-12-08', '2026-12-10', '2026-12-15', '2026-12-17']);
    assert.match(await p.textContent('.gerar-aulas-msg'), /6 aulas criadas/);
    await p.click('#btnAdicionarAula');
    const hs = await p.$$eval('#aulas-lista input[type=text]', (l) => l.map((e) => e.value));
    assert.equal(hs.length, 7);
    assert.equal(hs[6], '18:00 – 22:00');
    const nomes = await p.$$eval('#aulas-lista input', (l) => l.map((e) => e.name));
    assert.equal(new Set(nomes).size, nomes.length, 'nomes únicos');
    await p.fill('.gerar-aulas-ate', '2026-11-01');
    await p.click('.gerar-aulas-bt');
    assert.match(await p.textContent('.gerar-aulas-msg'), /A data final é antes do início\./);
  } finally { await b.close(); }
});
