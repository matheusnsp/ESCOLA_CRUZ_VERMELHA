// 2026-11-13: Novo curso em 3 passos (Task 6 do plano docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const S = require('../src/lib/curso-secoes');

test('lerNovoCurso: junta as seções e diz em que passo está o erro', () => {
  const base = { nome: 'Cuidador Infantil', cargaHoraria: '120', precoAvista: '900', precoCheio: '1000', parcelas: '10', taxaMatricula: '60', descricaoLonga: 'T', conteudoProgramatico: 'A\r\nB' };
  const r = S.lerNovoCurso(base);
  assert.equal(r.erro, null);
  assert.equal(r.dados.nome, 'Cuidador Infantil');
  assert.equal(r.dados.valorParcela, 100);
  assert.equal(r.dados.ativo, false, 'nasce fora do site');
  assert.equal(r.extras.conteudoProgramatico, 'A\nB');
  assert.equal(S.lerNovoCurso({ ...base, ativo: 'on' }).dados.ativo, true);
  assert.deepEqual(S.lerNovoCurso({ ...base, nome: '' }).passo, 1);
  const v = S.lerNovoCurso({ ...base, precoAvista: 'muito' });
  assert.equal(v.passo, 2);
  assert.equal(v.erro, 'Verifique os valores (use numeros, ex.: 150.00).');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }

describe('Novo curso: rota e tela', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const sfx = String(Date.now()).slice(-7);
  const criados = [];
  let gerente; let soCriar;
  const montar = (perms) => {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.locals.rotuloTurma = (s) => s;
    app.use(express.static(path.join(__dirname, '..', 'src', 'public')));
    app.use(express.urlencoded({ extended: true }));
    const pode = (p) => perms.includes(p);
    app.use((req, res, next) => { req.session = { usuarioId: 'teste-novo' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'X', pode, usuario: { nome: 'T' } }); next(); });
    app.use(require('../src/routes/painel-cursos')({ requirePermissao: (...ps) => (q, r, n) => (ps.some(pode) ? n() : r.status(403).send('403')), auditar: async () => {} }));
    return new Promise((r) => { const s = app.listen(0, () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
  };
  const post = (url, c) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(c).toString() });
  const campos = (nome) => ({ nome, cargaHoraria: '120', precoAvista: '900', precoCheio: '1000', parcelas: '10', taxaMatricula: '60', descricao: 'R', descricaoLonga: 'T' });

  before(async () => { gerente = await montar(['cursos:criar', 'cursos:gerenciar']); soCriar = await montar(['cursos:criar']); });
  after(async () => {
    gerente.s.close(); soCriar.s.close();
    const cs = await prisma.curso.findMany({ where: { nome: { contains: sfx } }, select: { id: true } });
    await prisma.configuracao.deleteMany({ where: { OR: cs.map((c) => ({ chave: { contains: c.id } })) } }).catch(() => {});
    await prisma.curso.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
  });

  test('criar: nasce fora do site e abre o resumo; só criar volta para a lista', async () => {
    const r = await post(`${gerente.url}/cursos`, campos(`Novo Passos ${sfx}`));
    assert.equal(r.status, 302);
    const c = await prisma.curso.findFirst({ where: { nome: `Novo Passos ${sfx}` } });
    assert.equal(c.ativo, false);
    assert.equal(r.headers.get('location'), `/cursos/${c.id}?ok=${encodeURIComponent('Curso criado.')}`);
    const r2 = await post(`${soCriar.url}/cursos`, campos(`Novo Passos B ${sfx}`));
    assert.equal(r2.headers.get('location'), `/cursos?ok=${encodeURIComponent('Curso criado.')}`);
  });

  test('erro volta 400 no passo do campo, com o que foi digitado', async () => {
    const r = await post(`${gerente.url}/cursos`, { ...campos(`Novo Erro ${sfx}`), precoAvista: 'muito' });
    assert.equal(r.status, 400);
    const html = await r.text();
    assert.match(html, /data-passo-erro="2"/);
    assert.match(html, new RegExp(`Novo Erro ${sfx}`));
  });

  test('tela: passos, Mais detalhes e o assistente preenchendo campo escondido', { skip: chromium ? false : 'sem Playwright' }, async () => {
    const b = await chromium.launch();
    try {
      const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${gerente.url}/cursos/novo`);
      const visivel = (n) => p.evaluate((x) => !document.querySelector(`[data-passo="${x}"]`).hidden, n);
      assert.equal(await visivel(1), true);
      assert.equal(await visivel(2), false);
      // visível de verdade (o estilo dos botões não pode vencer o hidden)
      assert.equal(await p.isVisible('[data-passos-erro]'), false, 'caixa de erro vazia escondida');
      assert.equal(await p.isVisible('[data-passos-voltar]'), false);
      assert.equal(await p.isVisible('[data-passos-criar]'), false);
      assert.equal(await p.isVisible('[data-passos-continuar]'), true);
      await p.click('[data-passos-continuar]');
      assert.equal(await visivel(1), true, 'sem nome não avança');
      assert.match(await p.textContent('[data-passos-erro]'), /Informe o nome do curso\./);
      await p.fill('[name=nome]', 'Teste');
      await p.fill('[name=cargaHoraria]', '20');
      await p.click('[data-passos-continuar]');
      assert.equal(await visivel(2), true);
      await p.click('[data-passos-voltar]');
      assert.equal(await visivel(1), true);
      assert.equal(await p.evaluate(() => document.querySelector('#maisDetalhes').open), false);
      await p.evaluate(() => { document.querySelector('[name=conteudoProgramatico]').value = 'A'; window.admPassos.mostrarTudoQueVeio({ conteudoProgramatico: 'A', precoAvista: '900' }); });
      assert.equal(await p.evaluate(() => document.querySelector('#maisDetalhes').open), true);
      assert.equal(await p.evaluate(() => !!document.querySelector('[name=precoAvista]').closest('label').querySelector('.adm-tag-ia')), true);
      const nomes = await p.evaluate(() => [...new FormData(document.querySelector('#cursoNovo')).keys()]);
      for (const n of ['nome', 'cargaHoraria', 'precoAvista', 'precoCheio', 'parcelas', 'taxaMatricula', 'descricao', 'descricaoLonga', 'conteudoProgramatico', 'nomeCertificado', 'certificadoValidade']) assert.ok(nomes.includes(n), n);
      await p.close();
    } finally { await b.close(); }
  });
});
