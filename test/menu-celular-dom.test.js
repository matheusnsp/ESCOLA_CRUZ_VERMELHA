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

  async function pagina(corpo, largura = 390, { semJs = false, antes = '' } = {}) {
    const p = await navegador.newPage({ viewport: { width: largura, height: 780 } });
    await p.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="adm">${antes}<main class="adm-wrap">${corpo}</main></body></html>`);
    await p.addStyleTag({ content: CSS });
    if (!semJs) await p.addScriptTag({ content: JS });
    return p;
  }
  const GAVETA = `<div class="adm-topo-cel"><span class="adm-topo-onde">Turmas</span><button type="button" class="adm-menu-btn" aria-controls="admLado" aria-expanded="false">Menu</button></div>
    <div class="adm-lado-fundo" id="admLadoFundo" hidden></div>
    <header class="adm-top" id="admLado"><button type="button" class="adm-lado-fechar">x</button><nav class="adm-nav"><div class="adm-grp" data-grupo="g"><button type="button" class="adm-grp-tit" aria-expanded="false">Alunos</button><div class="adm-grp-itens"><a href="/alunos">Alunos</a></div></div></nav></header>`;
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

  test('(+) flutuante: um botão de criar vira o (+) com o mesmo link; no computador fica como hoje', async () => {
    const html = `<div class="adm-h1-row"><h1 class="adm-h1">Turmas</h1><a href="/turmas/nova" class="adm-btn" data-criar><i class="fa-solid fa-plus"></i> Nova turma</a></div>`;
    const p = await pagina(html);
    assert.equal(await visivel(p, '.adm-h1-row [data-criar]'), false);
    assert.equal(await visivel(p, '.adm-fab'), true);
    assert.equal(await p.getAttribute('.adm-fab', 'href'), '/turmas/nova');
    assert.equal(await p.getAttribute('.adm-fab', 'aria-label'), 'Nova turma');
    await p.close();
    const pc = await pagina(html, 1280);
    assert.equal(await visivel(pc, '.adm-h1-row [data-criar]'), true);
    assert.equal(await visivel(pc, '.adm-fab'), false);
    await pc.close();
  });

  test('(+) também esconde botão marcado fora do topo (barra de filtros, caixa de módulos)', async () => {
    const p = await pagina(`<form class="adm-filtros"><a href="/cursos/novo" class="adm-btn" data-criar><i class="fa-solid fa-plus"></i> Novo curso</a></form>`);
    assert.equal(await visivel(p, '[data-criar]'), false);
    assert.equal(await p.getAttribute('.adm-fab', 'href'), '/cursos/novo');
    await p.close();
  });

  test('(+) com várias opções (Contas): abre a lista com as três e fecha tocando fora', async () => {
    const p = await pagina(`<div class="adm-h1-row"><h1 class="adm-h1">Contas</h1>
      <a href="/contas/nova?tipo=DESPESA" class="adm-btn" data-criar><i class="fa-solid fa-plus"></i> Nova despesa</a>
      <a href="/contas/nova?tipo=COMPRA" class="adm-btn-sec" data-criar><i class="fa-solid fa-cart-shopping"></i> Pedido de compra</a>
      <a href="/contas/nova?tipo=REEMBOLSO" class="adm-btn-sec" data-criar><i class="fa-solid fa-hand-holding-dollar"></i> Reembolso</a></div>`);
    assert.equal(await p.$$eval('.adm-fab', (l) => l.length), 1);
    assert.equal(await visivel(p, '.adm-fab-menu'), false);
    await p.click('.adm-fab');
    assert.equal(await visivel(p, '.adm-fab-menu'), true);
    assert.deepEqual(await p.$$eval('.adm-fab-menu a', (l) => l.map((a) => [a.textContent.trim(), a.getAttribute('href'), !!a.querySelector('i.fa-solid')])), [
      ['Nova despesa', '/contas/nova?tipo=DESPESA', true], ['Pedido de compra', '/contas/nova?tipo=COMPRA', true], ['Reembolso', '/contas/nova?tipo=REEMBOLSO', true]]);
    await p.mouse.click(20, 200);
    assert.equal(await visivel(p, '.adm-fab-menu'), false);
    await p.close();
  });

  test('revisão: com o menu aberto o (+) some (não leva para outra página por cima da gaveta)', async () => {
    const p = await pagina(`<a href="/turmas/nova" class="adm-btn" data-criar>Nova turma</a>`, 390, { antes: GAVETA });
    assert.equal(await visivel(p, '.adm-fab'), true);
    await p.click('.adm-menu-btn');
    assert.equal(await visivel(p, '.adm-fab'), false);
    await p.close();
  });

  test('revisão: contagem com .adm-badge-sutil (Dúvidas) vira a bolinha do cartão e da lista', async () => {
    const p = await pagina(`<nav class="adm-abas" aria-label="Dúvidas"><a href="#a" class="adm-aba on">Aguardando resposta <span class="adm-badge-sutil">3</span></a><a href="#b" class="adm-aba">Respondidas <span class="adm-badge-sutil">9</span></a></nav>`);
    assert.equal((await p.textContent('.adm-filtro-cel b')).trim(), 'Aguardando resposta');
    assert.equal((await p.textContent('.adm-filtro-num')).trim(), '3');
    await p.click('.adm-filtro-cel');
    assert.deepEqual(await p.$$eval('.adm-folha-num', (l) => l.map((e) => e.textContent.trim())), ['3', '9']);
    await p.close();
  });

  test('revisão: sem o script (falhou ao carregar) nada some — abas, menu e grupos ficam à vista', async () => {
    const p = await pagina(TURMAS, 390, { semJs: true, antes: GAVETA });
    assert.equal(await visivel(p, '.adm-abas'), true);
    assert.equal(await p.$eval('.adm-top', (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).visibility !== 'hidden' && r.right > 0; }), true);
    assert.equal(await visivel(p, '.adm-grp-itens'), true);
    assert.equal(await visivel(p, '.adm-menu-btn'), false);
    await p.close();
    const pc = await pagina('', 1280, { semJs: true, antes: GAVETA });
    assert.equal(await visivel(pc, '.adm-grp-itens'), true);
    await pc.close();
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

test('botões de criar do topo marcados para virar (+) no celular; os do meio do conteúdo não', () => {
  const V = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', f), 'utf8');
  const marcados = (f) => (V(f).match(/data-criar\b/g) || []).length;
  for (const f of ['turmas.ejs', 'cursos.ejs', 'dev-usuarios.ejs', 'ead/cupons.ejs', 'ead/ebooks.ejs', 'ead/escolas.ejs', 'ead/ia-lista.ejs', 'ead/curso.ejs']) assert.equal(marcados(f), 1, f);
  assert.equal(marcados('contas.ejs'), 3);
  assert.doesNotMatch(V('ead/escolas.ejs'), /data-criar[^>]*>\s*<i[^>]*><\/i>\s*Outro lote/);
  assert.match(V('ead/escolas.ejs'), /href="\/ead\/escolas\/lote\/novo"\s+data-criar/);
});

test('no tablet (até 1024 px) a caixa com tabela larga rola para o lado em vez de cortar as colunas', () => {
  // Revisão visual de 13/11: em 820 px a tabela de Cursos passava 193 px da tela e as últimas colunas sumiam.
  assert.match(CSS, /@media \(max-width: 1024px\) \{\s*\.adm-box \{ overflow-x: auto; \}/);
});
