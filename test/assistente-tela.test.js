// 2026-11-13: tela do assistente (spec §5): botão, painel, streaming, Markdown seguro, preencher formulários.
// Chromium (Playwright) com o header.ejs, admin.css e /js/admin-assistente.js de verdade e uma API falsa. Sem Playwright, pula.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* pula */ }
const RAIZ = path.join(__dirname, '..', 'src');
const CSS = fs.readFileSync(path.join(RAIZ, 'public', 'admin.css'), 'utf8');
const JS_MENU = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'admin-menu.js'), 'utf8');
const JS = () => fs.readFileSync(path.join(RAIZ, 'public', 'js', 'admin-assistente.js'), 'utf8');

async function header(ativo) {
  return ejs.renderFile(path.join(RAIZ, 'views', 'admin', 'header.ejs'), {
    ativo, modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'tok', usuario: { nome: 'Dev' }, montarMenu: require('../src/lib/menu-painel').montarMenu,
  });
}
const FORM_CURSO = `<h1 class="adm-h1">Novo curso</h1><form class="adm-form" id="f"><input name="nome"><input name="cargaHoraria" type="number"><input name="precoAvista">
  <select name="categoria"><option value="">—</option><option>Emergência e primeiros socorros</option></select><textarea name="descricao"></textarea>
  <input type="checkbox" name="exigeComprovanteSaude"><div class="ia-faqs" hidden><div class="ia-faqs-lista"></div></div><button type="submit">Salvar</button></form>
  <script>window.envios = 0; document.getElementById('f').addEventListener('submit', function (e) { e.preventDefault(); window.envios++; }); window.mudou = 0; document.querySelector('[name=nome]').addEventListener('input', function () { window.mudou++; });</script>`;
const FORM_TURMA = `<h1 class="adm-h1">Nova turma</h1><form class="adm-form"><select name="cursoId"><option value="">—</option><option value="c1">Curso 1</option></select><input name="inicioPrevisto" type="date"><input name="vagas">
  <div id="aulas-lista"><div class="aula-linha"><input type="date" name="aulas[0][data]"><input type="text" name="aulas[0][horario]"></div></div>
  <button type="button" id="btnAdicionarAula">Adicionar aula</button></form>
  <script>document.getElementById('btnAdicionarAula').addEventListener('click', function () { var l = document.getElementById('aulas-lista'); var i = l.children.length; var d = document.createElement('div'); d.className = 'aula-linha'; d.innerHTML = '<input type="date" name="aulas[' + i + '][data]"><input type="text" name="aulas[' + i + '][horario]">'; l.appendChild(d); });</script>`;

describe('tela do assistente', { skip: chromium ? false : 'sem Playwright' }, () => {
  let navegador; let respostas = []; let pedidos = [];
  before(async () => { navegador = await chromium.launch(); });
  after(async () => { if (navegador) await navegador.close(); });

  async function abrir(caminho, corpo, ativo, largura = 1280, ctx) {
    const c = ctx || await navegador.newContext({ viewport: { width: largura, height: 800 } });
    const p = await c.newPage();
    await p.route('http://painel.teste/**', async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/assistente/mensagem') {
        pedidos.push(JSON.parse(r.request().postData()));
        return r.fulfill({ contentType: 'application/x-ndjson', body: (respostas.shift() || []).map((e) => JSON.stringify(e)).join('\n') + '\n' });
      }
      const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body class="adm">${await header(ativo)}${u.pathname === '/cursos/novo' ? FORM_CURSO : u.pathname === '/turmas/nova' ? FORM_TURMA : '<h1 class="adm-h1">Pendentes</h1>'}</main><script>${JS_MENU}</script><script>${JS()}</script></body></html>`;
      return r.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    await p.goto('http://painel.teste' + caminho);
    return p;
  }
  const vis = (p, s) => p.$eval(s, (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && !e.closest('[hidden]'); }).catch(() => false);

  test('abre e fecha (botão, X, Esc), "Você está em", sugestões; envia com a página e o CSRF', async () => {
    respostas = [[{ tipo: 'texto', texto: 'Olá' }, { tipo: 'resposta', texto: 'Olá!' }, { tipo: 'fim' }]]; pedidos = [];
    const p = await abrir('/pendentes?aba=sem-taxa', '', 'pendentes');
    assert.equal(await vis(p, '#admAssist'), false);
    await p.click('#admAssistBtn');
    assert.equal(await vis(p, '#admAssist'), true);
    assert.match(await p.textContent('.adm-assist-onde'), /Você está em\s*Pendentes/);
    assert.ok((await p.$$('.adm-assist-sug button')).length >= 3);
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.tagName), 'TEXTAREA');
    await p.fill('.adm-assist-form textarea', 'quem não pagou?');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo)');
    assert.equal(pedidos[0]._csrf, 'tok');
    assert.deepEqual(pedidos[0].pagina, { caminho: '/pendentes', busca: '?aba=sem-taxa' });
    assert.deepEqual(pedidos[0].mensagens, [{ papel: 'pessoa', texto: 'quem não pagou?' }]);
    await p.keyboard.press('Escape');
    assert.equal(await vis(p, '#admAssist'), false);
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'admAssistBtn');
    await p.click('#admAssistBtn'); await p.click('.adm-assist-x');
    assert.equal(await vis(p, '#admAssist'), false);
    await p.context().close();
  });

  test('Markdown seguro: tabela, negrito, lista e link-botão; HTML do modelo vira texto', async () => {
    respostas = [[{ tipo: 'ferramenta', nome: 'listar_pendentes' }, { tipo: 'texto', texto: 'parcial' },
      { tipo: 'resposta', texto: '**3 pessoas**:\n\n| Aluno | Falta |\n|---|---|\n| Maria <img src=x onerror=window.xss=1> | R$ 180,00 |\n\n1. um\n2. dois\n\n<script>window.xss=2</script>\n\n[Abrir Pendentes](/pendentes?aba=com-taxa) e [mau](javascript:window.xss=3)' }, { tipo: 'fim' }]];
    const p = await abrir('/pendentes', '', 'pendentes');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'x'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo) table');
    const ia = '.adm-assist-ia:last-child';
    assert.equal(await p.textContent(`${ia} strong`), '3 pessoas');
    assert.equal(await p.$$eval(`${ia} table tr`, (l) => l.length), 2);
    assert.match(await p.textContent(`${ia} td`), /<img src=x onerror=window\.xss=1>/);
    assert.equal(await p.$$eval(`${ia} ol li`, (l) => l.length), 2);
    assert.equal(await p.getAttribute(`${ia} a.adm-assist-link`, 'href'), '/pendentes?aba=com-taxa');
    assert.equal(await p.$$eval(`${ia} a`, (l) => l.length), 1);
    assert.equal(await p.evaluate(() => window.xss), undefined);
    await p.context().close();
  });

  test('conversa fica na aba (sessionStorage) ao trocar de página; "Nova conversa" limpa', async () => {
    respostas = [[{ tipo: 'resposta', texto: 'Resposta 1' }, { tipo: 'fim' }]];
    const c = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    let p = await abrir('/pendentes', '', 'pendentes', 1280, c);
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'pergunta 1'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo)');
    await p.goto('http://painel.teste/turmas/nova');
    await p.click('#admAssistBtn');
    assert.deepEqual(await p.$$eval('.adm-assist-eu, .adm-assist-ia', (l) => l.map((e) => e.textContent.trim())), ['pergunta 1', 'Resposta 1']);
    await p.click('.adm-assist-nova');
    assert.equal(await p.$$eval('.adm-assist-eu, .adm-assist-ia', (l) => l.length), 0);
    await c.close();
  });

  test('preencher curso na própria página: preenche, dispara input, não envia; FAQs na lista da IA', async () => {
    respostas = [[{ tipo: 'preencher', formulario: 'curso', campos: { nome: 'Curso X', cargaHoraria: '8', precoAvista: '180.00', categoria: 'Emergência e primeiros socorros', descricao: 'Resumo.', exigeComprovanteSaude: true, faqs: [{ pergunta: 'P?', resposta: 'R.' }] } },
      { tipo: 'resposta', texto: 'Preparei.' }, { tipo: 'fim' }]];
    const p = await abrir('/cursos/novo', '', 'cursos');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'cria o curso'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-cartao .adm-assist-preencher');
    assert.match(await p.textContent('.adm-assist-cartao'), /Nome[\s\S]*Curso X/);
    await p.click('.adm-assist-preencher');
    assert.equal(await p.inputValue('[name=nome]'), 'Curso X');
    assert.equal(await p.inputValue('[name=cargaHoraria]'), '8');
    assert.equal(await p.inputValue('[name=categoria]'), 'Emergência e primeiros socorros');
    assert.equal(await p.isChecked('[name=exigeComprovanteSaude]'), true);
    assert.equal(await p.inputValue('[name="faqsIa[0][pergunta]"]'), 'P?');
    assert.equal(await p.evaluate(() => window.mudou), 1);
    assert.equal(await p.evaluate(() => window.envios), 0);
    await p.context().close();
  });

  test('preencher turma: cria as linhas de aula pelo botão da tela', async () => {
    respostas = [[{ tipo: 'preencher', formulario: 'turma', campos: { cursoId: 'c1', vagas: '30', aulas: [{ data: '2026-12-02', horario: '18:00 – 22:00' }, { data: '2026-12-04', horario: '18:00 – 22:00' }, { data: '2026-12-09', horario: '18:00 – 22:00' }] } },
      { tipo: 'resposta', texto: 'Ok.' }, { tipo: 'fim' }]];
    const p = await abrir('/turmas/nova', '', 'turmas');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'turma'); await p.keyboard.press('Enter');
    await p.click('.adm-assist-preencher');
    assert.equal(await p.$$eval('.aula-linha', (l) => l.length), 3);
    assert.equal(await p.inputValue('[name="aulas[2][data]"]'), '2026-12-09');
    assert.equal(await p.inputValue('[name="aulas[0][horario]"]'), '18:00 – 22:00');
    assert.equal(await p.inputValue('[name=cursoId]'), 'c1');
    await p.context().close();
  });

  test('em outra página: "Abrir Novo curso e preencher" leva e preenche ao chegar (uma vez)', async () => {
    respostas = [[{ tipo: 'preencher', formulario: 'curso', campos: { nome: 'Curso Y' } }, { tipo: 'resposta', texto: 'Ok.' }, { tipo: 'fim' }]];
    const c = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await abrir('/pendentes', '', 'pendentes', 1280, c);
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'cria'); await p.keyboard.press('Enter');
    await p.waitForSelector('a.adm-assist-abrir');
    assert.match(await p.textContent('a.adm-assist-abrir'), /Abrir Novo curso e preencher/);
    await Promise.all([p.waitForNavigation(), p.click('a.adm-assist-abrir')]);
    await p.waitForFunction(() => document.querySelector('[name=nome]') && document.querySelector('[name=nome]').value === 'Curso Y');
    assert.equal(await vis(p, '#admAssist'), true);
    await p.reload();
    assert.equal(await p.inputValue('[name=nome]'), '');
    await c.close();
  });

  test('celular: botão na barra do topo, painel em tela cheia', async () => {
    respostas = [];
    const p = await abrir('/pendentes', '', 'pendentes', 390);
    assert.equal(await vis(p, '#admAssistBtn'), false);
    assert.equal(await vis(p, '.adm-assist-top'), true);
    await p.click('.adm-assist-top');
    const w = await p.$eval('#admAssist', (e) => e.getBoundingClientRect().width);
    assert.ok(w >= 389, `largura ${w}`);
    await p.context().close();
  });

  test('streaming aparece aos poucos (sem links) e o tema escuro usa as cores escuras', async () => {
    const p = await abrir('/pendentes', '', 'pendentes');
    await p.evaluate(() => {
      document.documentElement.setAttribute('data-tema', 'escuro');
      window.liberar = null;
      window.fetch = () => {
        const enc = new TextEncoder();
        const corpo = new ReadableStream({ start(c) {
          c.enqueue(enc.encode(JSON.stringify({ tipo: 'texto', texto: 'Primeira parte [Abrir](/pendentes)' }) + '\n'));
          window.liberar = () => { c.enqueue(enc.encode(JSON.stringify({ tipo: 'resposta', texto: 'Tudo [Abrir](/pendentes)' }) + '\n' + JSON.stringify({ tipo: 'fim' }) + '\n')); c.close(); };
        } });
        return Promise.resolve(new Response(corpo, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
      };
    });
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'x'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Primeira parte/.test((document.querySelector('.adm-assist-ia.escrevendo') || {}).textContent || ''));
    assert.equal(await p.$$eval('.adm-assist-ia.escrevendo a', (l) => l.length), 0);
    await p.evaluate(() => window.liberar());
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo) a.adm-assist-link');
    const fundo = await p.$eval('#admAssist', (e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(fundo, 'rgb(255, 255, 255)');
    await p.context().close();
  });

  test('revisão final: sem "resposta" final, o texto parcial fica sem links', async () => {
    respostas = [[{ tipo: 'texto', texto: 'Veja [Abrir](/pendentes)' }, { tipo: 'fim' }]];
    const p = await abrir('/pendentes', '', 'pendentes');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'oi'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo)');
    assert.equal(await p.$$eval('.adm-assist-ia a', (l) => l.length), 0);
    assert.match(await p.textContent('.adm-assist-ia'), /Veja Abrir/);
    await p.context().close();
  });

  test('formato: tabela não quebra palavra letra por letra; link no meio da frase é texto, link sozinho é botão', async () => {
    respostas = [[{ tipo: 'resposta', texto: '| Aluno | Curso | Falta |\n|---|---|---|\n| Fernanda Abreu | Primeiros Socorros Básico | R$ 279,00 |\n\nPara cobrar, abra [a tela de Pendentes](/pendentes) e use o WhatsApp.\n\n[Abrir Pendentes](/pendentes?aba=com-taxa) [Ver inscrições](/alunos)' }, { tipo: 'fim' }]];
    const p = await abrir('/pendentes', '', 'pendentes');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'x'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo) table');
    const td = await p.$eval('.adm-assist-tabela td', (e) => { const cs = getComputedStyle(e); return { ow: cs.overflowWrap, wb: cs.wordBreak }; });
    assert.equal(td.ow, 'normal'); assert.notEqual(td.wb, 'break-all');
    assert.equal(await p.$eval('.adm-assist-tabela th', (e) => getComputedStyle(e).whiteSpace), 'nowrap');
    // a palavra "Fernanda" cabe numa linha: altura da célula ≈ 1–2 linhas, não 4+
    assert.ok(await p.$eval('.adm-assist-tabela td', (e) => e.getBoundingClientRect().height) < 60);
    assert.equal(await p.$$eval('.adm-assist-ia p:not(.adm-assist-botoes) a.adm-assist-link', (l) => l.length), 1);
    assert.equal(await p.$$eval('.adm-assist-ia p.adm-assist-botoes a.adm-assist-link', (l) => l.length), 2);
    await p.context().close();
  });

  test('pequenos ajustes: proposta de EDIÇÃO fora da página leva à edição, não ao Novo curso', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    respostas = [[{ tipo: 'preencher', formulario: 'curso', campos: { precoAvista: '500.00' }, editar: { id, caminho: `/cursos/${id}/editar`, nome: 'Socorrista' } }, { tipo: 'resposta', texto: 'Ok.' }, { tipo: 'fim' }]];
    const p = await abrir('/cursos/novo', '', 'cursos');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'muda o preço do Socorrista'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-cartao');
    assert.equal(await p.$$eval('.adm-assist-preencher', (l) => l.length), 0); // não preenche o Novo curso com dados de outro curso
    assert.equal(await p.getAttribute('a.adm-assist-abrir', 'href'), `/cursos/${id}/editar`);
    assert.match(await p.textContent('a.adm-assist-abrir'), /Abrir a edição de Socorrista e preencher/);
    assert.match(await p.textContent('.adm-assist-cartao-tit'), /Editar curso: Socorrista/);
    await p.context().close();
  });

  test('celular: tocar em Assistente abre só o painel (sem teclado); o foco vai para o campo só quando a pessoa toca nele', async () => {
    respostas = [[{ tipo: 'resposta', texto: 'Oi.' }, { tipo: 'fim' }]];
    const c = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await abrir('/pendentes', '', 'pendentes', 390, c);
    await p.tap('.adm-assist-top');
    assert.equal(await vis(p, '#admAssist'), true);
    assert.notEqual(await p.evaluate(() => document.activeElement && document.activeElement.tagName), 'TEXTAREA');
    assert.equal(await p.evaluate(() => window.scrollY), 0);
    await p.tap('.adm-assist-form textarea');
    await p.keyboard.type('oi'); await p.tap('.adm-assist-form button[type=submit]');
    await p.waitForSelector('.adm-assist-ia:not(.escrevendo)');
    assert.notEqual(await p.evaluate(() => document.activeElement && document.activeElement.tagName), 'TEXTAREA'); // teclado não volta sozinho
    await c.close();
  });

  test('celular: com o painel aberto a página por trás fica travada (iPhone não rola ao abrir o teclado) e volta ao mesmo lugar ao fechar', async () => {
    const c = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await abrir('/pendentes', '', 'pendentes', 390, c);
    await p.evaluate(() => { const d = document.createElement('div'); d.style.height = '3000px'; document.querySelector('main').appendChild(d); window.scrollTo(0, 700); });
    await p.tap('.adm-assist-top');
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).position), 'fixed');
    assert.equal(await p.evaluate(() => document.body.style.top), '-700px');
    assert.match(await p.$eval('#admAssist', (e) => getComputedStyle(e).boxShadow), /0px 0px 0px \d+px/); // em volta do painel: cor do painel (faixa atrás da barra do Safari)
    await p.tap('.adm-assist-x');
    assert.notEqual(await p.evaluate(() => getComputedStyle(document.body).position), 'fixed');
    assert.equal(await p.evaluate(() => Math.round(window.scrollY)), 700);
    await c.close();
  });

  test('erro vira mensagem amigável', async () => {
    respostas = [[{ tipo: 'erro', mensagem: 'O assistente está fora do ar agora. Tente de novo em instantes.' }, { tipo: 'fim' }]];
    const p = await abrir('/pendentes', '', 'pendentes');
    await p.click('#admAssistBtn'); await p.fill('.adm-assist-form textarea', 'oi'); await p.keyboard.press('Enter');
    await p.waitForSelector('.adm-assist-erro');
    assert.match(await p.textContent('.adm-assist-erro'), /fora do ar/);
    await p.context().close();
  });
});

test('foot.ejs carrega /js/admin-assistente.js e o header tem o botão com o CSRF', () => {
  assert.match(fs.readFileSync(path.join(RAIZ, 'views', 'admin', 'foot.ejs'), 'utf8'), /<script src="<%= asset\('\/js\/admin-assistente\.js'\) %>"><\/script>/);
  const h = fs.readFileSync(path.join(RAIZ, 'views', 'admin', 'header.ejs'), 'utf8');
  assert.match(h, /id="admAssistBtn"[^>]*data-csrf="<%= csrfToken %>"/);
  assert.match(h, /class="adm-assist-top"/);
});
