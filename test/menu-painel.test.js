// 2026-11-13: menu do painel em grupos (spec docs/superpowers/specs/2026-11-13-menu-submenus-design.md §1).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { montarMenu, ATIVOS } = require('../src/lib/menu-painel');

const todas = () => true;
const so = (lista) => (p) => lista.includes(p);
const grupos = (m) => m.filter((g) => !g.separador);
const g = (m, rot) => grupos(m).find((x) => x.rotulo === rot);

test('DEV presencial: grupos, ordem, separador e grupo ativo aberto', () => {
  const m = montarMenu({ modo: 'presencial', papel: 'DEV', pode: todas, ativo: 'horarios' });
  assert.deepEqual(grupos(m).map((x) => x.rotulo), ['Painel', 'Cursos e turmas', 'Alunos', 'Financeiro', 'Certificados', 'Configurações']);
  const iSep = m.findIndex((x) => x.separador);
  assert.equal(m[iSep].separador, 'Sistema');
  assert.equal(m[iSep + 1].rotulo, 'Configurações');
  const ct = g(m, 'Cursos e turmas');
  assert.ok(ct.aberto && ct.ativo);
  assert.deepEqual(ct.itens.map((i) => i.rotulo), ['Cursos', 'Turmas', 'Matrícula rápida', 'Mapa de horários', 'Mensagem de boas-vindas']);
  assert.deepEqual(ct.itens.map((i) => i.href), ['/cursos', '/turmas', '/matricula-rapida', '/horarios', '/modelos']);
  assert.ok(!g(m, 'Alunos').aberto);
  assert.deepEqual(g(m, 'Alunos').itens.map((i) => i.rotulo), ['Alunos', 'Matrículas', 'Pendentes', 'Comprovantes', 'Pesquisa de satisfação']);
  assert.deepEqual(g(m, 'Financeiro').itens.map((i) => i.rotulo), ['Financeiro', 'Contas a pagar', 'Cupons']);
  assert.deepEqual(g(m, 'Configurações').itens.map((i) => i.rotulo), ['Usuários do painel', 'Permissões', 'Alunos banidos', 'Suspeitos', 'Integração']);
  assert.equal(g(m, 'Painel').href, '/');
  assert.equal(g(m, 'Certificados').href, '/certificados');
});

test('DEV online: grupos, Vendas aberto e selo de dúvidas no item e no grupo', () => {
  const m = montarMenu({ modo: 'online', papel: 'DEV', pode: todas, ativo: 'cupons', duvidasAguardando: 3 });
  assert.deepEqual(grupos(m).map((x) => x.rotulo), ['Cursos online', 'Conteúdos', 'Vendas', 'Certificados', 'Configurações']);
  assert.ok(g(m, 'Vendas').aberto);
  assert.deepEqual(g(m, 'Vendas').itens.map((i) => i.rotulo), ['Cupons', 'Escolas (lotes)']);
  const co = g(m, 'Cursos online');
  assert.deepEqual(co.itens.map((i) => i.rotulo), ['Cursos', 'Criar curso com IA', 'Dúvidas dos alunos']);
  assert.equal(co.itens[2].selo, 3);
  assert.equal(co.selo, 3);
  assert.deepEqual(g(m, 'Conteúdos').itens.map((i) => i.href), ['/ead/ebooks', '/ead/webinarios']);
});

test('Secretaria: só o que tem permissão; grupo sem item some', () => {
  const m = montarMenu({ modo: 'presencial', papel: 'SECRETARIA', pode: so(['turmas:gerenciar', 'pendentes:gerenciar', 'aluno:gerenciar']), ativo: 'turmas' });
  assert.equal(g(m, 'Financeiro'), undefined);
  assert.equal(g(m, 'Configurações'), undefined);
  assert.equal(m.some((x) => x.separador), false);
  assert.deepEqual(g(m, 'Alunos').itens.map((i) => i.rotulo), ['Alunos', 'Pendentes', 'Comprovantes']);
});

test('Só integração: Configurações com um item', () => {
  const m = montarMenu({ modo: 'presencial', papel: 'FINANCEIRO', pode: so(['integracao:gerenciar']), ativo: 'integracao' });
  assert.deepEqual(g(m, 'Configurações').itens.map((i) => i.rotulo), ['Integração']);
  assert.ok(g(m, 'Configurações').aberto);
});

test('Modo online só para DEV (outro papel cai no presencial)', () => {
  const m = montarMenu({ modo: 'online', papel: 'SECRETARIA', pode: todas, ativo: 'ead' });
  assert.equal(g(m, 'Cursos online'), undefined);
  assert.ok(g(m, 'Cursos e turmas'));
});

test('ativo desconhecido ou ausente: nada aberto, sem erro', () => {
  for (const ativo of [undefined, '', 'xyz']) {
    const m = montarMenu({ modo: 'presencial', papel: 'DEV', pode: todas, ativo });
    assert.equal(grupos(m).some((x) => x.aberto || x.ativo), false);
  }
});

test('todo ativo usado nas views do painel existe no menu', () => {
  const raiz = path.join(__dirname, '..', 'src', 'views', 'admin');
  const usados = new Set();
  (function andar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) andar(p); else if (f.endsWith('.ejs')) { const m = fs.readFileSync(p, 'utf8').match(/include\(['"](?:\.\.\/)?header['"],\s*\{[^}]*ativo:\s*['"]([^'"]+)/); if (m) usados.add(m[1]); } } })(raiz);
  assert.ok(usados.size > 15);
  for (const a of usados) assert.ok(ATIVOS.has(a), `ativo sem item no menu: ${a}`);
});
