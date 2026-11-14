// 2026-11-13: "Começar com a IA" no Novo curso (Task 7) e na Nova turma (Task 10) — plano
// docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md. A IA só propõe; tudo passa pelas validações do assistente.
require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clienteFalso } = require('./helpers/ia-falso');
const C = require('../src/lib/ia-comecar');

const TEXTO = 'Cuidador Infantil, 120 horas, pra quem quer trabalhar com crianças. R$ 900 à vista ou R$ 1000 em 10x, taxa 60.';

test('comecarCurso: campos validados (lixo descartado) e textos pelo Escrever com IA', async () => {
  const txt = require('../src/lib/ia-textos');
  const orig = txt.escrever;
  const pedidos = [];
  txt.escrever = async (args) => { pedidos.push(args); return { textos: { descricao: 'R', descricaoLonga: 'T', conteudoProgramatico: 'A\nB', faqs: [{ pergunta: 'P?', resposta: 'R.' }] }, usage: { input_tokens: 1, output_tokens: 1 } }; };
  try {
    const cli = clienteFalso([() => ({ nome: 'Cuidador Infantil', cargaHoraria: 120, escolaridadeMinima: null, categoria: 'Culinária', precoAvista: 'muito', precoCheio: 1000, parcelas: 10, taxaMatricula: 60 })]);
    const r = await C.comecarCurso(TEXTO, { cliente: cli });
    assert.equal(r.campos.nome, 'Cuidador Infantil');
    assert.equal(r.campos.cargaHoraria, '120');
    assert.equal(r.campos.precoCheio, '1000.00');
    assert.equal(r.campos.parcelas, '10');
    assert.equal(r.campos.taxaMatricula, '60.00');
    assert.equal('precoAvista' in r.campos, false, 'preço inválido fica de fora');
    assert.equal('categoria' in r.campos, false, 'área fora da lista fica de fora');
    assert.equal('escolaridadeMinima' in r.campos, false, 'o que a pessoa não disse fica em branco');
    assert.equal(r.textos.descricaoLonga, 'T');
    assert.equal(pedidos[0].tipo, 'presencial');
    assert.equal(pedidos[0].ideias, TEXTO);
    assert.equal(pedidos[0].dados.nome, 'Cuidador Infantil');
    assert.equal(cli.chamadas[0].output_config.effort, 'low');
    assert.match(JSON.stringify(cli.chamadas[0].messages), /Cuidador Infantil, 120 horas/);
    assert.ok(r.usage.length === 2, 'custo das duas chamadas');
  } finally { txt.escrever = orig; }
});

test('comecarCurso: texto vazio', async () => {
  await assert.rejects(() => C.comecarCurso('   '), /Escreva o que você sabe do curso\./);
});

const path = require('path');
const express = require('express');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

function appCursos() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.locals.asset = require('../src/lib/assets').asset;
  app.locals.montarMenu = require('../src/lib/menu-painel').montarMenu;
  app.locals.rotuloTurma = (s) => s;
  app.use(express.static(path.join(__dirname, '..', 'src', 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => { req.session = { usuarioId: 'teste-ia' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'X', pode: () => true, usuario: { nome: 'T' } }); next(); });
  app.use(require('../src/routes/painel-cursos')({ requirePermissao: () => (q, r, n) => n(), auditar: async () => {} }));
  return new Promise((r) => { const s = app.listen(0, () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
}

test('rota /cursos/ia-comecar: teto, texto vazio e resposta', { skip: temBanco ? false : 'sem banco' }, async () => {
  const ia = require('../src/lib/ead-ia');
  const orig = { chave: ia.ehChaveConfigurada, teto: ia.dentroDoTeto, somar: ia.somarCustoAvulso, comecar: C.comecarCurso };
  const somados = [];
  ia.ehChaveConfigurada = () => true; ia.somarCustoAvulso = async (u) => { somados.push(u); };
  const srv = await appCursos();
  const post = (texto) => fetch(`${srv.url}/cursos/ia-comecar`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ texto }).toString() }).then((r) => r.json());
  try {
    ia.dentroDoTeto = async () => ({ ok: false, erro: 'Teto atingido.' });
    assert.deepEqual(await post(TEXTO), { ok: false, erro: 'Teto atingido.' });
    ia.dentroDoTeto = async () => ({ ok: true });
    assert.deepEqual(await post(' '), { ok: false, erro: 'Escreva o que você sabe do curso.' });
    C.comecarCurso = async () => ({ campos: { nome: 'X' }, textos: { descricao: 'R' }, usage: [{ a: 1 }, { b: 2 }] });
    assert.deepEqual(await post(TEXTO), { ok: true, campos: { nome: 'X' }, textos: { descricao: 'R' } });
    assert.equal(somados.length, 2);
    C.comecarCurso = async () => { throw new Error('caiu'); };
    assert.deepEqual(await post(TEXTO), { ok: false, erro: 'A IA não conseguiu agora; preencha à mão ou tente de novo.' });
  } finally { Object.assign(ia, { ehChaveConfigurada: orig.chave, dentroDoTeto: orig.teto, somarCustoAvulso: orig.somar }); C.comecarCurso = orig.comecar; srv.s.close(); }
});

test('tela: Preencher com IA preenche os passos, as dúvidas e etiqueta IA', { skip: temBanco && chromium ? false : 'sem banco/Playwright' }, async () => {
  const srv = await appCursos();
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.route('**/cursos/ia-comecar', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, campos: { nome: 'Cuidador Infantil', cargaHoraria: '120', precoAvista: '900.00', conteudoProgramatico: 'x' }, textos: { descricao: 'Resumo', descricaoLonga: 'Texto', conteudoProgramatico: 'A\nB', faqs: [{ pergunta: 'P?', resposta: 'R.' }] } }) }));
    await p.goto(`${srv.url}/cursos/novo`);
    await p.fill('.adm-comecar-texto', TEXTO);
    await p.click('.adm-comecar-bt');
    await p.waitForFunction(() => document.querySelector('[name=nome]').value === 'Cuidador Infantil');
    assert.equal(await p.inputValue('[name=precoAvista]'), '900.00');
    assert.equal(await p.inputValue('[name=descricaoLonga]'), 'Texto');
    assert.equal(await p.inputValue('[name=conteudoProgramatico]'), 'A\nB');
    assert.equal(await p.evaluate(() => document.querySelector('#maisDetalhes').open), true);
    assert.equal(await p.evaluate(() => document.querySelectorAll('.ia-faqs-lista .ia-faq').length), 1);
    assert.equal(await p.evaluate(() => !!document.querySelector('[name=nome]').closest('label').querySelector('.adm-tag-ia')), true);
    assert.match(await p.textContent('.adm-comecar-ia .ia-textos-msg'), /nada foi salvo/);
  } finally { await b.close(); srv.s.close(); }
});
