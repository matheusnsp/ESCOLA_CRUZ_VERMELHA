// 2026-11-13: lista de cursos com Abrir e "Falta" (Task 5 do plano docs/superpowers/plans/2026-11-13-cursos-turmas-telas.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const render = (x) => ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'admin', 'cursos.ejs'), {
  ativo: 'cursos', modoPainel: 'presencial', admPapel: 'COORDENACAO', csrfToken: 'x', usuario: { nome: 'T' },
  asset: (u) => u, montarMenu: require('../src/lib/menu-painel').montarMenu, rotuloTurma: (s) => s, formatBRL: (v) => `R$ ${v}`,
  flash: null, erro: null, busca: '', statusFiltro: null, contagem: { todos: 2, ativos: 1, inativos: 1 }, total: 2, ...x,
});
const curso = (o) => ({ id: '11111111-1111-1111-1111-111111111111', nome: 'Cuidador de Idosos', cargaHoraria: 160, categoria: 'Cuidados e saúde', ativo: true, imagemUrl: null, turmas: [], faltas: ['Foto', 'Conteúdo do certificado'], valores: null, _count: { turmas: 0 }, ...o });

test('lista: filtros com contagem, coluna Falta e Abrir só para quem edita', async () => {
  const html = await render({ cursos: [curso()], pode: (p) => ['cursos:gerenciar', 'cursos:criar'].includes(p) });
  assert.match(html, /href="\/cursos"[^>]*>\s*Todos · 2/);
  assert.match(html, /href="\/cursos\?status=ATIVO"[^>]*>\s*No site · 1/);
  assert.match(html, /href="\/cursos\?status=INATIVO"[^>]*>\s*Fora do site · 1/);
  assert.match(html, /Falta/);
  assert.match(html, /adm-falta[^>]*>Foto</);
  assert.match(html, /adm-falta[^>]*>Conteúdo do certificado</);
  assert.match(html, /href="\/cursos\/11111111-1111-1111-1111-111111111111"[^>]*>\s*Abrir/);
  assert.doesNotMatch(html, /\/ativar"|\/excluir"/, 'Ocultar e Excluir saem da linha');
  assert.match(html, /160 h · Cuidados e saúde/);
  const leitura = await render({ cursos: [curso()], pode: (p) => p === 'painel:leitura' });
  assert.doesNotMatch(leitura, />\s*Abrir/);
  assert.doesNotMatch(leitura, /href="\/cursos\/novo"/);
});
