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
  assert.deepEqual(grupos(m).map((x) => x.rotulo), ['Painel', 'Cursos', 'Turmas', 'Alunos', 'Financeiro', 'Certificados', 'Configurações']);
  const iSep = m.findIndex((x) => x.separador);
  assert.equal(m[iSep].separador, 'Sistema');
  assert.equal(m[iSep + 1].rotulo, 'Configurações');
  const tu = g(m, 'Turmas');
  assert.ok(tu.aberto && tu.ativo);
  assert.equal(tu.id, 'turmas-grupo');
  assert.deepEqual(tu.itens.map((i) => i.rotulo), ['Todas as turmas', 'Nova turma', 'Matrícula rápida', 'Mapa de horários', 'Mensagem de boas-vindas']);
  assert.deepEqual(tu.itens.map((i) => i.href), ['/turmas', '/turmas/nova', '/matricula-rapida', '/horarios', '/modelos']);
  const cu = g(m, 'Cursos');
  assert.equal(cu.id, 'cursos-grupo');
  assert.ok(!cu.aberto);
  assert.deepEqual(cu.itens.map((i) => i.rotulo), ['Todos os cursos', 'Novo curso']);
  assert.deepEqual(cu.itens.map((i) => i.href), ['/cursos', '/cursos/novo']);
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
  assert.ok(g(m, 'Cursos') && g(m, 'Turmas'));
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

test('Cursos e Turmas: Novo curso e Nova turma só com permissão; ativo curso-novo abre Cursos', () => {
  const leitura = (p) => p === 'painel:leitura';
  const m = montarMenu({ modo: 'presencial', papel: 'CONSULTA', pode: leitura, ativo: 'cursos' });
  assert.deepEqual(g(m, 'Cursos').itens.map((i) => i.rotulo), ['Todos os cursos']);
  assert.deepEqual(g(m, 'Turmas').itens.map((i) => i.rotulo), ['Todas as turmas', 'Matrícula rápida', 'Mapa de horários']);
  const n = montarMenu({ modo: 'presencial', papel: 'DEV', pode: todas, ativo: 'curso-novo' });
  assert.ok(g(n, 'Cursos').aberto);
  assert.ok(g(n, 'Cursos').itens.find((i) => i.rotulo === 'Novo curso').ativo);
  const t = montarMenu({ modo: 'presencial', papel: 'DEV', pode: todas, ativo: 'turma-nova' });
  assert.ok(g(t, 'Turmas').aberto);
  assert.equal(montarMenu({ modo: 'presencial', papel: 'DEV', pode: todas }).some((x) => x.id === 'cursos-turmas'), false);
});
