// 2026-11-13: telas novas de Cursos — resumo do curso e seções com salvar próprio (Task 3 do plano
// docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

function montar(perms) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.locals.asset = require('../src/lib/assets').asset;
  app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
  app.locals.rotuloTurma = (s) => ({ ENCERRADA: 'CONCLUÍDA' }[s] || s);
  app.use(express.static(path.join(__dirname, '..', 'src', 'public')));
  app.use(express.urlencoded({ extended: true }));
  const pode = (p) => perms.includes(p);
  app.use((req, res, next) => { req.session = { usuarioId: 'teste-cursos', papel: 'COORDENACAO' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'COORDENACAO', pode, usuario: { nome: 'Teste' } }); next(); });
  const requirePermissao = (...ps) => (req, res, next) => (ps.some(pode) ? next() : res.status(403).send('sem permissao'));
  app.use(require('../src/routes/painel-cursos')({ requirePermissao, auditar: async () => {} }));
  return app;
}
const ouvir = (app) => new Promise((r) => { const s = app.listen(0, () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
const post = (url, campos) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos).toString() });

describe('painel de cursos: resumo e seções', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const extras = require('../src/lib/extras');
  const sfx = String(Date.now()).slice(-7);
  let srv; let leitura; let curso; let comTurma; let turma;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Seções ${sfx}`, cargaHoraria: 16, precoAvista: 100, precoCheio: 120, valorParcela: 40, parcelas: 3, ativo: true, descricaoLonga: 'Texto antigo', imagemUrl: '/uploads/foto-teste.webp' } });
    await extras.salvarExtra('curso', curso.id, { conteudoProgramatico: 'Item A', certAssinaturas: ['a0', 'instrutor'] });
    comTurma = await prisma.curso.create({ data: { nome: `Curso Com Turma ${sfx}`, cargaHoraria: 8, precoAvista: 1, precoCheio: 1, valorParcela: 1, ativo: true } });
    turma = await prisma.turma.create({ data: { cursoId: comTurma.id, inicioPrevisto: new Date(Date.now() + 9 * 86400000), vagas: 10, minimoAlunos: 0, status: 'ABERTA' } });
    srv = await ouvir(montar(['cursos:gerenciar', 'cursos:criar']));
    leitura = await ouvir(montar(['painel:leitura']));
  });
  after(async () => {
    srv.s.close(); leitura.s.close();
    await prisma.turma.deleteMany({ where: { id: turma.id } });
    for (const c of [curso, comTurma]) { await extras.salvarExtra('curso', c.id, { conteudoProgramatico: null, certAssinaturas: null, categoria: null, nomeCertificado: null, certificadoValidade: null, exigeComprovanteSaude: null }); }
    await prisma.curso.deleteMany({ where: { id: { in: [curso.id, comTurma.id] } } });
  });

  test('resumo: os 6 cartões com os links e o que falta', async () => {
    const html = await (await fetch(`${srv.url}/cursos/${curso.id}`)).text();
    for (const s of ['pagina', 'valores', 'certificado', 'duvidas', 'turmas', 'publicacao']) assert.match(html, new RegExp(`href="/cursos/${curso.id}/${s}"`));
    for (const t of ['Página no site', 'Valores', 'Certificado', 'Dúvidas frequentes', 'Turmas deste curso', 'Inscrição e publicação']) assert.match(html, new RegExp(t));
    assert.match(html, /Falta: Dúvidas frequentes/);
    assert.doesNotMatch(html, /Falta: Foto/);
  });

  test('salvar Valores não apaga foto, textos, conteúdo programático nem assinaturas', async () => {
    const r = await post(`${srv.url}/cursos/${curso.id}/valores`, { precoAvista: '130,00', precoCheio: '150', parcelas: '5', taxaMatricula: '' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `/cursos/${curso.id}?ok=${encodeURIComponent('Valores salvos.')}`);
    const c = await prisma.curso.findUnique({ where: { id: curso.id } });
    assert.equal(Number(c.precoAvista), 130);
    assert.equal(c.imagemUrl, '/uploads/foto-teste.webp');
    assert.equal(c.descricaoLonga, 'Texto antigo');
    assert.equal(c.nome, curso.nome);
    const ex = await extras.lerExtra('curso', curso.id);
    assert.equal(ex.conteudoProgramatico, 'Item A');
    assert.deepEqual(ex.certAssinaturas, ['a0', 'instrutor']);
  });

  test('Página: nome vazio volta 400 com a mensagem e o que foi digitado', async () => {
    const r = await post(`${srv.url}/cursos/${curso.id}/pagina`, { nome: '', cargaHoraria: '16', descricao: 'Resumo digitado' });
    assert.equal(r.status, 400);
    const html = await r.text();
    assert.match(html, /Informe o nome do curso\./);
    assert.match(html, /Resumo digitado/);
  });

  test('Certificado: salva só os campos dele e respeita o limite de assinaturas', async () => {
    const ok = await post(`${srv.url}/cursos/${curso.id}/certificado`, { conteudoProgramatico: 'Item B\r\nItem C', nomeCertificado: '', certificadoValidade: '' });
    assert.equal(ok.status, 302);
    assert.equal((await extras.lerExtra('curso', curso.id)).conteudoProgramatico, 'Item B\nItem C');
    const campos = { conteudoProgramatico: 'x' };
    for (let i = 0; i < 5; i++) { campos[`assin[${i}][nome]`] = `Pessoa ${i}`; campos[`assin[${i}][marcado]`] = '1'; }
    const r = await post(`${srv.url}/cursos/${curso.id}/certificado`, campos);
    assert.equal(r.status, 400);
    assert.match(await r.text(), /no máximo 4 assinaturas/);
  });

  test('Publicação: mostrar no site e comprovante', async () => {
    const r = await post(`${srv.url}/cursos/${curso.id}/publicacao`, { exigeComprovanteSaude: 'on' });
    assert.equal(r.status, 302);
    assert.equal((await prisma.curso.findUnique({ where: { id: curso.id } })).ativo, false);
    assert.equal((await extras.lerExtra('curso', curso.id)).exigeComprovanteSaude, true);
  });

  test('excluir: desabilitado com turma (com o motivo); habilitado sem nada', async () => {
    const com = await (await fetch(`${srv.url}/cursos/${comTurma.id}/publicacao`)).text();
    assert.match(com, /<button[^>]*class="adm-btn-perigo"[^>]*disabled/);
    assert.match(com, /tem turmas/);
    const sem = await (await fetch(`${srv.url}/cursos/${curso.id}/publicacao`)).text();
    assert.match(sem, /action="\/cursos\/[^"]+\/excluir"[^>]*data-confirmar=/);
    const r = await post(`${srv.url}/cursos/${comTurma.id}/excluir`, {});
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /\/publicacao\?erro=/);
  });

  test('resumo e seção cabem no celular (390 px), claro e escuro', { skip: (() => { try { require('playwright'); return false; } catch (e) { return 'sem Playwright'; } })() }, async () => {
    const { chromium } = require('playwright');
    const b = await chromium.launch();
    try {
      for (const tema of ['claro', 'escuro']) {
        const p = await b.newPage({ viewport: { width: 390, height: 800 } });
        await p.addInitScript((t) => { try { localStorage.setItem('adm-tema', t); } catch (e) {} }, tema);
        for (const u of [`/cursos/${curso.id}`, `/cursos/${curso.id}/valores`]) {
          await p.goto(srv.url + u);
          const larg = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
          assert.ok(larg[0] <= larg[1], `${tema} ${u}: ${larg[0]} > ${larg[1]}`);
        }
        await p.close();
      }
    } finally { await b.close(); }
  });

  test('links antigos e permissões', async () => {
    const r = await fetch(`${srv.url}/cursos/${curso.id}/editar`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `/cursos/${curso.id}`);
    assert.equal((await fetch(`${leitura.url}/cursos/${curso.id}`)).status, 403);
    assert.equal((await fetch(`${leitura.url}/cursos/${curso.id}/valores`)).status, 403);
    assert.equal((await fetch(`${srv.url}/cursos/00000000-0000-0000-0000-000000000000`)).status, 404);
  });
});
