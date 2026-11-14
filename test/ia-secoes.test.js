// 2026-11-13: IA nas seções do curso — Desfazer e conteúdo programático sugerido (Task 8 do plano
// docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { clienteFalso } = require('./helpers/ia-falso');
const txt = require('../src/lib/ia-textos');

test('sugerirConteudo: um item por linha, sem marcadores nem linhas vazias', async () => {
  const cli = clienteFalso([() => ({ conteudo: '- Envelhecimento\n\n• Higiene e conforto\n1. Alimentação\n   Mobilização  ' })]);
  const r = await txt.sugerirConteudo({ nome: 'Cuidador de Idosos', descricaoLonga: 'O Curso de Cuidador…' }, { cliente: cli });
  assert.equal(r.conteudo, 'Envelhecimento\nHigiene e conforto\nAlimentação\nMobilização');
  assert.equal(cli.chamadas[0].output_config.effort, 'low');
  assert.match(JSON.stringify(cli.chamadas[0].messages), /Cuidador de Idosos/);
  assert.match(JSON.stringify(cli.chamadas[0].system), /preço/i);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }

describe('IA nas seções', { skip: temBanco ? false : 'sem banco' }, () => {
  const prisma = require('../src/db');
  let srv; let curso;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso IA Seção ${Date.now()}`, cargaHoraria: 8, precoAvista: 1, precoCheio: 1, valorParcela: 1, descricao: 'Resumo antigo', descricaoLonga: 'Texto antigo' } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
    app.locals.rotuloTurma = (s) => s;
    app.use(express.static(path.join(__dirname, '..', 'src', 'public')));
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: 't' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'X', pode: () => true, usuario: { nome: 'T' } }); next(); });
    app.use(require('../src/routes/painel-cursos')({ requirePermissao: () => (q, r, n) => n(), auditar: async () => {} }));
    await new Promise((r) => { const s = app.listen(0, () => { srv = { s, url: `http://127.0.0.1:${s.address().port}` }; r(); }); });
  });
  after(async () => { srv.s.close(); await prisma.curso.delete({ where: { id: curso.id } }); });

  test('rota ia-conteudo: teto e resposta', async () => {
    const ia = require('../src/lib/ead-ia');
    const orig = { chave: ia.ehChaveConfigurada, teto: ia.dentroDoTeto, somar: ia.somarCustoAvulso, sug: txt.sugerirConteudo };
    ia.ehChaveConfigurada = () => true; ia.somarCustoAvulso = async () => {};
    const post = () => fetch(`${srv.url}/cursos/${curso.id}/ia-conteudo`, { method: 'POST' }).then((r) => r.json());
    try {
      ia.dentroDoTeto = async () => ({ ok: false, erro: 'Teto atingido.' });
      assert.deepEqual(await post(), { ok: false, erro: 'Teto atingido.' });
      ia.dentroDoTeto = async () => ({ ok: true });
      txt.sugerirConteudo = async (d) => ({ conteudo: `Item de ${d.nome}`, usage: {} });
      assert.deepEqual(await post(), { ok: true, conteudo: `Item de ${curso.nome}` });
    } finally { Object.assign(ia, { ehChaveConfigurada: orig.chave, dentroDoTeto: orig.teto, somarCustoAvulso: orig.somar }); txt.sugerirConteudo = orig.sug; }
  });

  test('tela: Reescrever e Desfazer; Sugerir com IA no certificado', { skip: chromium ? false : 'sem Playwright' }, async () => {
    const b = await chromium.launch();
    try {
      const p = await b.newPage();
      p.on('dialog', (d) => d.accept());
      await p.route('**/cursos/ia-textos', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, textos: { descricao: 'Resumo novo', descricaoLonga: 'Texto novo' } }) }));
      await p.goto(`${srv.url}/cursos/${curso.id}/pagina`);
      await p.click('.ia-textos-bt');
      await p.waitForFunction(() => document.querySelector('[name=descricaoLonga]').value === 'Texto novo');
      await p.click('.ia-desfazer');
      assert.equal(await p.inputValue('[name=descricaoLonga]'), 'Texto antigo');
      assert.equal(await p.inputValue('[name=descricao]'), 'Resumo antigo');
      assert.equal(await p.isVisible('.ia-desfazer'), false);
      await p.route('**/ia-conteudo', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, conteudo: 'Higiene\nAlimentação' }) }));
      await p.goto(`${srv.url}/cursos/${curso.id}/certificado`);
      await p.click('.ia-conteudo-bt');
      await p.waitForFunction(() => document.querySelector('[name=conteudoProgramatico]').value === 'Higiene\nAlimentação');
      assert.equal(await p.evaluate(() => !!document.querySelector('[name=conteudoProgramatico]').closest('label').querySelector('.adm-tag-ia')), true);
    } finally { await b.close(); }
  });
});
