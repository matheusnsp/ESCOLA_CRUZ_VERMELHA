// 2026-11-13: painel no celular — filtros viram cartão com lista; botão de criar vira (+) flutuante.
// Roda no Chromium (Playwright) com o admin.css e o /js/admin-menu.js de verdade. Sem Playwright, pula.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* sem Playwright: pula */ }
const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'admin.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'admin-menu.js'), 'utf8');

describe('painel no celular (DOM)', { skip: chromium ? false : 'sem Playwright' }, () => {
  let navegador;
  before(async () => { navegador = await chromium.launch(); });
  after(async () => { if (navegador) await navegador.close(); });

  async function pagina(corpo, largura = 390) {
    const p = await navegador.newPage({ viewport: { width: largura, height: 780 } });
    await p.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="adm"><main class="adm-wrap">${corpo}</main></body></html>`);
    await p.addStyleTag({ content: CSS });
    await p.addScriptTag({ content: JS });
    return p;
  }
  const visivel = (p, sel) => p.$eval(sel, (e) => getComputedStyle(e).display !== 'none' && !e.closest('[hidden]'));

  const TURMAS = `<nav class="adm-abas" aria-label="Turmas">
    <a href="#a" class="adm-aba">Por começar <span class="adm-aba-num">1</span></a>
    <a href="#b" class="adm-aba on">Concluídas <span class="adm-aba-num">7</span></a>
    <a href="#c" class="adm-aba adm-aba-sep"><i class="fa-solid fa-bolt"></i> Matrícula rápida</a>
    <a href="/ead/curso/1/planilha.xlsx" class="adm-aba">Excel</a>
  </nav><p>lista</p>`;

  test('cartão "Mostrando" com o filtro atual e a contagem; abas somem no celular', async () => {
    const p = await pagina(TURMAS);
    assert.equal(await visivel(p, '.adm-abas'), false);
    assert.equal(await visivel(p, '.adm-filtro-cel'), true);
    assert.match(await p.textContent('.adm-filtro-cel'), /Mostrando\s*Concluídas\s*7/);
    await p.close();
  });

  test('tocar abre a lista: título, ✓ no atual, separado e download depois da linha; escolher navega', async () => {
    const p = await pagina(TURMAS);
    await p.click('.adm-filtro-cel');
    assert.equal(await visivel(p, '.adm-folha'), true);
    assert.equal((await p.textContent('.adm-folha h3')).trim(), 'Mostrar turmas');
    const itens = await p.$$eval('.adm-folha .adm-folha-item, .adm-folha .adm-folha-sep', (l) => l.map((e) => (e.classList.contains('adm-folha-sep') ? '—' : e.textContent.replace(/\s+/g, ' ').trim() + (e.classList.contains('on') ? ' ✓' : ''))));
    assert.deepEqual(itens, ['Por começar 1', 'Concluídas 7 ✓', '—', 'Matrícula rápida', 'Baixar planilha (Excel)']);
    await p.click('.adm-folha .adm-folha-item >> nth=0');
    assert.match(p.url(), /#a$/);
    await p.close();
  });

  test('fecha tocando fora e com Esc', async () => {
    const p = await pagina(TURMAS);
    await p.click('.adm-filtro-cel');
    await p.keyboard.press('Escape');
    assert.equal(await visivel(p, '.adm-folha'), false);
    await p.click('.adm-filtro-cel');
    await p.click('.adm-folha-fundo', { position: { x: 10, y: 10 } });
    assert.equal(await visivel(p, '.adm-folha'), false);
    await p.close();
  });

  test('abas de botões (Financeiro): a lista aciona o botão original e o cartão acompanha', async () => {
    const p = await pagina(`<div class="adm-abas adm-fin-abas" role="tablist" aria-label="Pagamentos">
      <button type="button" class="adm-aba on" data-filtro="todos">Todos <span class="adm-aba-num">15</span></button>
      <button type="button" class="adm-aba" data-filtro="estorno">Estornados <span class="adm-aba-num">2</span></button></div>
      <script>window.cliques = 0; document.querySelectorAll('.adm-fin-abas .adm-aba').forEach(function (b) { b.addEventListener('click', function () { window.cliques++; document.querySelectorAll('.adm-fin-abas .adm-aba').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });</script>`);
    await p.click('.adm-filtro-cel');
    await p.click('.adm-folha .adm-folha-item >> text=Estornados');
    assert.equal(await p.evaluate(() => window.cliques), 1);
    assert.equal(await visivel(p, '.adm-folha'), false);
    assert.match(await p.textContent('.adm-filtro-cel'), /Mostrando\s*Estornados\s*2/);
    await p.close();
  });

  test('duas linhas de filtro: dois cartões independentes', async () => {
    const p = await pagina(TURMAS + `<nav class="adm-abas" aria-label="Situação"><a href="#x" class="adm-aba on">Aguardando</a><a href="#y" class="adm-aba">Respondidas</a></nav>`);
    assert.equal(await p.$$eval('.adm-filtro-cel', (l) => l.length), 2);
    assert.match(await p.textContent('.adm-filtro-cel >> nth=1'), /Aguardando/);
    await p.close();
  });

  test('no computador nada muda: abas visíveis, sem cartão', async () => {
    const p = await pagina(TURMAS, 1280);
    assert.equal(await visivel(p, '.adm-abas'), true);
    assert.equal(await visivel(p, '.adm-filtro-cel'), false);
    await p.close();
  });
});

test('toda linha de filtro do painel tem nome (vira o título da lista no celular)', () => {
  const raiz = path.join(__dirname, '..', 'src', 'views', 'admin');
  const sem = [];
  (function andar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) andar(p); else if (f.endsWith('.ejs')) { for (const m of fs.readFileSync(p, 'utf8').matchAll(/<(?:nav|div) class="adm-abas[^"]*"[^>]*>/g)) if (!/aria-label="[^"]+"/.test(m[0])) sem.push(path.relative(raiz, p)); } } })(raiz);
  assert.deepEqual(sem, []);
});
