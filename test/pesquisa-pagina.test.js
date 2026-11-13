// 2026-11-13: página Pesquisa de satisfação com filtros e visual novo (spec 2026-11-13-pesquisa-filtros-design.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const pq = require('../src/lib/pesquisa');

const V = path.join(__dirname, '..', 'src', 'views', 'admin', 'pesquisa.ejs');
const resp = (o) => ({ matriculaId: 'm' + Math.random().toString(36).slice(2, 7), nota: 5, comentario: '', autoriza: false, status: 'nova', nome: 'Maria Silva', nomePublico: 'Maria S.', alunoId: 'a1', curso: 'Bombeiro Civil', cursoId: 'bc', turmaId: 'bc1', inicioTurma: '2026-09-01T00:00:00Z', respondidaEm: '2026-11-12T10:00:00Z', ...o });
const LISTA = [resp({ comentario: 'Ótimo curso', autoriza: true, matriculaId: 'm1' }), resp({ nota: 4, turmaId: 'bc2', inicioTurma: '2026-10-06T00:00:00Z', status: 'aprovada' }), resp({ nota: 2, comentario: 'quente', matriculaId: 'm3' })];

function render(x = {}) {
  const filtro = { curso: '', turma: '', nota: '', ...(x.filtro || {}) };
  const lista = x.lista || LISTA;
  return ejs.renderFile(V, {
    ativo: 'pesquisa', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'x', usuario: { nome: 'Dev' },
    asset: (u) => u, montarMenu: require('../src/lib/menu-painel').montarMenu,
    config: { mostrarNoSite: false }, flash: null, aba: 'todas',
    abas: [{ id: 'aguardando', rot: 'Aguardando aprovação', n: 1 }, { id: 'aprovadas', rot: 'No site', n: 1 }, { id: 'ocultas', rot: 'Ocultas', n: 0 }, { id: 'todas', rot: 'Todas as respostas', n: lista.length }],
    lista, filtro, opcoes: pq.opcoesFiltro(LISTA, filtro.curso), porCurso: pq.mediasPorCurso(LISTA),
    resumo: { ...pq.resumirRespostas(lista), enviadas: 5 }, totalGeral: LISTA.length,
    qs: pq.qsFiltro(filtro), ...x,
  });
}

test('filtros: curso, turma (só com curso), nota, Limpar e envio ao mudar', async () => {
  let html = await render();
  assert.match(html, /<form method="GET" action="\/pesquisa" class="[^"]*pq-filtros[^"]*" data-envia-ao-mudar/);
  assert.match(html, /<select name="curso"[\s\S]*?<option value="">Todos os cursos<\/option>[\s\S]*?<option value="bc">Bombeiro Civil<\/option>/);
  assert.doesNotMatch(html, /name="turma"/);
  assert.doesNotMatch(html, /Limpar filtros/);
  assert.match(html, /<button type="submit"[^>]*data-sem-js[^>]*>Aplicar<\/button>/);
  html = await render({ filtro: { curso: 'bc', nota: 'satisfeitos' } });
  assert.match(html, /<option value="bc" selected>Bombeiro Civil<\/option>/);
  assert.match(html, /<select name="turma"[\s\S]*?<option value="">Todas as turmas do curso<\/option>[\s\S]*?<option value="bc2">06\/10\/2026<\/option>[\s\S]*?<option value="bc1">01\/09\/2026<\/option>/);
  assert.match(html, /<option value="satisfeitos" selected>4 e 5 \(satisfeitos\)<\/option>/);
  assert.match(html, /<a href="\/pesquisa" class="pq-limpar">Limpar filtros<\/a>/);
  assert.match(html, /class="adm-recolhe-btn"[^>]*>[\s\S]*?Filtros[\s\S]*?Bombeiro Civil/);
});

test('cartões: média com estrelas e distribuição, satisfeitos, depoimentos com liga/desliga', async () => {
  const html = await render();
  assert.match(html, /class="pq-media-num">3,7</);
  assert.match(html, /3 respostas de 5 enviadas \(60%\)/);
  assert.equal((html.match(/class="pq-dist-linha"/g) || []).length, 6);
  assert.match(html, /class="pq-num">67%</);
  assert.match(html, /2 deram 4 ou 5 · 1 deu 0 a 2/);
  assert.match(html, /<form method="POST" action="\/pesquisa\/site"[\s\S]*?<button type="submit" class="pq-switch" role="switch" aria-checked="false"/);
});

test('nota média por curso: barras com link que filtra (mantém a nota) e destaque do curso filtrado', async () => {
  const html = await render({ filtro: { curso: 'bc', nota: 'neutros' } });
  assert.match(html, /<a href="\/pesquisa\?curso=bc&amp;nota=neutros" class="pq-curso on"/);
});

test('abas e ações mantêm o filtro', async () => {
  const html = await render({ filtro: { curso: 'bc', turma: 'bc1' } });
  assert.match(html, /href="\/pesquisa\?curso=bc&amp;turma=bc1&amp;aba=aguardando"/);
  const form = html.slice(html.indexOf('action="/pesquisa/m1/aprovar"'));
  assert.match(form.slice(0, 600), /name="curso" value="bc"[\s\S]*name="turma" value="bc1"/);
});

test('linhas compactas: comentário, aluno, curso, turma; só a nota quando não há comentário', async () => {
  const html = await render();
  assert.match(html, /<q class="pq-coment">Ótimo curso<\/q>/);
  assert.match(html, /Só a nota, sem comentário\./);
  assert.match(html, /Bombeiro Civil · turma 01\/09\/2026/);
});

test('vazio: com filtro diz "Nada com esses filtros."; sem respostas, o texto de hoje', async () => {
  assert.match(await render({ lista: [], filtro: { nota: 'neutros' } }), /Nada com esses filtros\./);
  assert.match(await render({ lista: [], totalGeral: 0, porCurso: [] }), /Ainda não chegou nenhuma resposta/);
});

test('só leitura: sem Aprovar e liga/desliga desabilitado', async () => {
  const html = await render({ pode: (p) => p === 'painel:leitura' });
  assert.doesNotMatch(html, /\/aprovar"/);
  assert.match(html, /class="pq-switch" role="switch" aria-checked="false" disabled/);
});

test('rota: filtros da query, envios pelo filtro e redirects com o filtro', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  const get = a.slice(a.indexOf("router.get('/pesquisa'"), a.indexOf("router.post('/pesquisa/site'"));
  assert.match(get, /pesquisa\.filtroDaQuery\(req\.query, todas\)/);
  assert.match(get, /pesquisa\.contarEnvios\(filtro\)/);
  const posts = a.slice(a.indexOf("router.post('/pesquisa/site'"), a.indexOf("router.post('/pesquisa/site'") + 2500);
  assert.equal((posts.match(/pesquisa\.qsFiltro\(/g) || []).length >= 2, true);
});
