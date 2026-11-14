// 2026-11-13: o assistente nas telas novas de Cursos e Turmas (Task 11 do plano
// docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md).
require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../src/lib/assistente-contexto');

const ROTAS = fs.readdirSync(path.join(__dirname, '..', 'src', 'routes')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', f), 'utf8')).join('\n');
// Caminhos GET que existem no código (com os :id e as listas de seção expandidos).
const GETS = [...ROTAS.matchAll(/(?:router\.get|\bget)\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => m[1])
  .flatMap((p) => { const m = /:secao\(([^)$]+)\)/.exec(p); return m ? m[1].split('|').map((s) => p.replace(m[0], s)) : [p]; })
  .map((p) => p.replace(/:([a-zA-Z]+)(\(\$\{ID\}\)|\([^)]*\))?/g, ':id').replace(/\$\{ID\}/g, ':id'));
const UUID = '11111111-2222-3333-4444-555555555555';
const existe = (url) => GETS.some((g) => { const re = new RegExp('^' + g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:id/g, '[^/]+') + '$'); return re.test(url) || re.test(url.replace(/^\/ead/, '')); });

test('todo caminho que o assistente conhece existe nas rotas (CATALOGO, registros e página atual)', () => {
  const orfaos = Object.keys(c.CATALOGO).filter((p) => !existe(p));
  assert.deepEqual(orfaos, [], `caminhos do CATALOGO sem rota: ${orfaos.join(', ')}`);
  for (const exemplo of [`/cursos/${UUID}`, `/cursos/${UUID}/valores`, `/cursos/${UUID}/duvidas`, `/cursos/${UUID}/turmas`, `/turmas/${UUID}`, `/turmas/${UUID}/editar`, `/turmas/${UUID}/notas`, `/alunos/${UUID}/matriculas`]) {
    assert.ok(existe(exemplo), `sem rota: ${exemplo}`);
  }
});

test('links de curso/turma só com id visto na conversa', () => {
  const ctx = { pode: () => true, papel: 'COORDENACAO', vistos: { cursos: new Set([UUID]), turmas: new Set(), alunos: new Set() } };
  assert.equal(c.linkAceito(`/cursos/${UUID}`, ctx), true);
  assert.equal(c.linkAceito(`/cursos/${UUID}/valores`, ctx), true);
  assert.equal(c.linkAceito(`/cursos/99999999-2222-3333-4444-555555555555`, ctx), false);
  assert.equal(c.linkAceito(`/turmas/${UUID}`, ctx), false);
  assert.equal(c.linkAceito('/turmas?aba=andamento&q=soco', ctx), true);
  assert.equal(c.linkAceito(`/cursos/${UUID}/editar`, ctx), false, 'caminho antigo não é mais linkado');
});

test('manual e regras falam das telas novas', () => {
  const s = c.montarSistema();
  assert.doesNotMatch(s, /Cursos e turmas ›/);
  for (const t of ['Abrir Valores e preencher', 'Salvar valores', 'Adicionar as marcadas', 'Gerar aulas', 'Começar com a IA', '/cursos/<id>/valores', '/turmas/<id>']) assert.ok(s.includes(t), t);
});

let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }
const ASSIST = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'admin-assistente.js'), 'utf8');

// Página mínima com o assistente montado e um formulário; o cartão é desenhado a partir de uma conversa salva.
async function paginaCom(b, caminho, corpo, preencher) {
  const p = await b.newPage();
  await p.route('http://painel.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="adm-js"><body>
    <button id="admAssistBtn" class="adm-assist-btn" data-csrf="x">Assistente</button><button class="adm-assist-top">A</button>
    ${corpo}</body></html>` }));
  await p.addInitScript((pr) => { sessionStorage.setItem('adm-assistente-conversa', JSON.stringify([{ papel: 'pessoa', texto: 'oi' }, { papel: 'assistente', texto: 'Preparei.', preencher: pr }])); }, preencher);
  await p.goto('http://painel.test' + caminho);
  await p.addScriptTag({ content: ASSIST });
  await p.click('#admAssistBtn');
  return p;
}

test('cartão de edição de curso: um botão por seção e o salvar de cada uma', { skip: chromium ? false : 'sem Playwright' }, async () => {
  const b = await chromium.launch();
  try {
    const prop = [{ formulario: 'curso', campos: { precoAvista: '1300.00', descricaoLonga: 'Novo texto' }, editar: { id: UUID, nome: 'Cuidador de Idosos', caminho: `/cursos/${UUID}`, secoes: [
      { secao: 'pagina', rotulo: 'Página no site', botao: 'Salvar página', campos: { descricaoLonga: 'Novo texto' }, caminho: `/cursos/${UUID}/pagina` },
      { secao: 'valores', rotulo: 'Valores', botao: 'Salvar valores', campos: { precoAvista: '1300.00' }, caminho: `/cursos/${UUID}/valores` }] } }];
    // Em outra página: dois links "Abrir … e preencher"
    let p = await paginaCom(b, '/', '', prop);
    const links = await p.$$eval('.adm-assist-cartao .adm-assist-abrir', (l) => l.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
    assert.deepEqual(links, [['Abrir Página no site e preencher', `/cursos/${UUID}/pagina`], ['Abrir Valores e preencher', `/cursos/${UUID}/valores`]]);
    assert.match(await p.textContent('.adm-assist-cartao small'), /Salvar página \/ Salvar valores/);
    await p.close();
    // Na seção Valores: só o campo de preço é preenchido
    p = await paginaCom(b, `/cursos/${UUID}/valores`, '<form><input name="precoAvista" value="1200"><input name="precoCheio" value="1350"><button>Salvar valores</button></form>', prop);
    const bts = await p.$$eval('.adm-assist-cartao .adm-assist-preencher, .adm-assist-cartao .adm-assist-abrir', (l) => l.map((x) => x.textContent.trim()));
    assert.deepEqual(bts, ['Abrir Página no site e preencher', 'Preencher na tela']);
    await p.click('.adm-assist-preencher');
    assert.equal(await p.inputValue('[name=precoAvista]'), '1300.00');
    assert.equal(await p.inputValue('[name=precoCheio]'), '1350');
    await p.close();
  } finally { await b.close(); }
});

test('dúvidas para curso existente viram sugestões marcadas na seção Dúvidas', { skip: chromium ? false : 'sem Playwright' }, async () => {
  const b = await chromium.launch();
  try {
    const prop = [{ formulario: 'curso', campos: { faqs: [{ pergunta: 'Tem estágio?', resposta: 'Sim.' }] }, editar: { id: UUID, nome: 'Cuidador', caminho: `/cursos/${UUID}`, secoes: [
      { secao: 'duvidas', rotulo: 'Dúvidas frequentes', botao: 'Adicionar as marcadas', campos: { faqs: [{ pergunta: 'Tem estágio?', resposta: 'Sim.' }] }, caminho: `/cursos/${UUID}/duvidas` }] } }];
    const p = await paginaCom(b, `/cursos/${UUID}/duvidas`, '<div class="ia-duvidas"><form class="ia-duvidas-form" hidden><div class="ia-faqs-lista"></div><button>Adicionar as marcadas</button></form></div>', prop);
    await p.click('.adm-assist-preencher');
    assert.equal(await p.isVisible('.ia-duvidas-form'), true);
    assert.equal(await p.inputValue('[name="faqsIa[0][pergunta]"]'), 'Tem estágio?');
    assert.equal(await p.isChecked('[name="faqsIa[0][usar]"]'), true);
  } finally { await b.close(); }
});
