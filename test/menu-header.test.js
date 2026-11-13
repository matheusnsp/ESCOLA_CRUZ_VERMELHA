// 2026-11-13: header do painel desenha o menu em grupos (lib/menu-painel.js) e o topo do celular.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const V = (p) => path.join(__dirname, '..', 'src', 'views', 'admin', p);
const ler = (p) => fs.readFileSync(V(p), 'utf8');

const render = (x = {}) => ejs.renderFile(V('header.ejs'), {
  ativo: 'turmas', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'x',
  usuario: { nome: 'Dev Teste' }, montarMenu: require('../src/lib/menu-painel').montarMenu, ...x,
});
const nav = (html) => html.slice(html.indexOf('<nav class="adm-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="adm-nav"')));

test('grupo do item ativo vem aberto e o item marcado', async () => {
  const html = await render({ ativo: 'permissoes' });
  assert.match(html, /<div class="adm-grp[^"]*" data-grupo="configuracoes"[^>]*>\s*<button type="button" class="adm-grp-tit" aria-expanded="true"/);
  assert.match(html, /<a href="\/dev\/permissoes" class="on" aria-current="page"/);
  assert.match(html, /data-grupo="cursos-turmas"[^>]*>\s*<button type="button" class="adm-grp-tit" aria-expanded="false"/);
});

test('nenhum link do menu antigo some (DEV presencial)', async () => {
  const hrefs = new Set([...nav(await render()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
  for (const h of ['/', '/cursos', '/turmas', '/ead/cupons', '/inscricoes', '/pendentes', '/alunos', '/certificados', '/comprovantes-saude', '/pesquisa', '/financeiro', '/contas', '/integracao', '/dev/usuarios']) {
    assert.ok(hrefs.has(h), `falta ${h}`);
  }
});

test('modo online e selo de dúvidas no grupo fechado', async () => {
  const html = await render({ modoPainel: 'online', ativo: 'ebooks', duvidasAguardando: 4 });
  assert.match(nav(html), /data-grupo="cursos-online"[\s\S]*?Cursos online[\s\S]*?<span class="adm-badge"[^>]*>4<\/span>/);
  assert.match(nav(html), /href="\/ead\/ebooks" class="on"/);
});

test('separador "Sistema" e itens fora da permissão não aparecem', async () => {
  const html = await render({ admPapel: 'SECRETARIA', pode: (p) => p === 'turmas:gerenciar' });
  assert.doesNotMatch(nav(html), /Sistema|\/financeiro|\/dev\/usuarios/);
  const dev = await render();
  assert.match(nav(dev), /<div class="adm-nav-sep">Sistema<\/div>/);
});

test('topo do celular com o nome da página e o botão Menu', async () => {
  const html = await render({ ativo: 'horarios' });
  assert.match(html, /<div class="adm-topo-cel">[\s\S]*?<span class="adm-topo-onde">Mapa de horários<\/span>[\s\S]*?<button type="button" class="adm-menu-btn" aria-controls="admLado" aria-expanded="false"/);
  assert.match(html, /<header class="adm-top" id="admLado"/);
  assert.match(html, /class="adm-lado-fechar"/);
});

test('server.js entrega montarMenu a todas as views', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8'), /app\.locals\.montarMenu = require\('\.\/lib\/menu-painel'\)\.montarMenu;/);
});

test('página sem ativo (erro) renderiza sem quebrar', async () => {
  const html = await render({ ativo: undefined });
  assert.match(html, /adm-nav/);
});

test('cada tela informa o próprio item do menu', () => {
  const ativo = (p) => (ler(p).match(/include\(['"](?:\.\.\/)?header['"],\s*\{[^}]*ativo:\s*['"]([^'"]+)/) || [])[1];
  assert.equal(ativo('matricula-rapida.ejs'), 'matricula-rapida');
  assert.equal(ativo('horarios.ejs'), 'horarios');
  assert.equal(ativo('modelos.ejs'), 'boas-vindas');
  assert.equal(ativo('dev-permissoes.ejs'), 'permissoes');
  for (const f of ['ead/ia-lista.ejs', 'ead/ia-form.ejs', 'ead/ia-geracao.ejs']) assert.equal(ativo(f), 'ia', f);
});

test('script do menu carregado no rodapé e localStorage sempre protegido', () => {
  assert.match(ler('foot.ejs'), /<script src="<%= asset\('\/js\/admin-menu\.js'\) %>"><\/script>/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'admin-menu.js'), 'utf8');
  const usos = js.split('localStorage').length - 1;
  assert.ok(usos >= 2);
  for (const linha of js.split('\n').filter((l) => l.includes('localStorage') && !l.trim().startsWith('//'))) assert.match(linha, /try\s*\{/, linha.trim());
});
