// 2026-11-13: botão "Recarregar" na barra do topo do painel, só quando aberto como app (tela de início),
// onde o celular não tem o recarregar do navegador. Chromium (Playwright) com header.ejs, admin.css e admin-menu.js reais.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* pula */ }
const RAIZ = path.join(__dirname, '..', 'src');

describe('botão recarregar (app)', { skip: chromium ? false : 'sem Playwright' }, () => {
  let b; let html;
  before(async () => {
    b = await chromium.launch();
    const header = await ejs.renderFile(path.join(RAIZ, 'views', 'admin', 'header.ejs'), { ativo: 'turmas', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 't', usuario: { nome: 'Dev' }, montarMenu: require('../src/lib/menu-painel').montarMenu });
    html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fs.readFileSync(path.join(RAIZ, 'public', 'admin.css'), 'utf8')}</style></head><body class="adm">${header}<h1>Turmas</h1></main><script>${fs.readFileSync(path.join(RAIZ, 'public', 'js', 'admin-menu.js'), 'utf8')}</script></body></html>`;
  });
  after(async () => { if (b) await b.close(); });
  const abrir = async (app, largura = 390) => {
    const c = await b.newContext({ viewport: { width: largura, height: 800 }, isMobile: largura < 800, hasTouch: true });
    if (app) await c.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
    await c.route('http://painel.teste/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    const p = await c.newPage(); await p.goto('http://painel.teste/turmas'); return { c, p };
  };
  const visivel = (p) => p.$eval('.adm-recarregar', (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0; }).catch(() => false);

  test('no app (iPhone, tela de início): aparece na barra do topo e recarrega', async () => {
    const { c, p } = await abrir(true);
    assert.equal(await visivel(p), true);
    assert.equal(await p.getAttribute('.adm-recarregar', 'aria-label'), 'Recarregar a página');
    await p.evaluate(() => { window.marca = 1; });
    await Promise.all([p.waitForNavigation(), p.tap('.adm-recarregar')]);
    assert.equal(await p.evaluate(() => window.marca), undefined); // página nova
    await c.close();
  });

  test('no navegador comum: não aparece (lá já tem o recarregar do navegador)', async () => {
    const { c, p } = await abrir(false);
    assert.equal(await visivel(p), false);
    await c.close();
  });

  test('cabe na barra do topo em 320 px junto com Assistente e Menu', async () => {
    const { c, p } = await abrir(true, 320);
    const caixas = await p.$$eval('.adm-topo-cel > *', (l) => l.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect().right));
    assert.ok(Math.max(...caixas) <= 320, `passou da tela: ${Math.max(...caixas)}`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await c.close();
  });
});
