// 2026-11-13 (pedido do Matheus): cada página tem um caminho só — o menu. Nada de abas que repetem o menu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = (p) => path.join(__dirname, '..', 'src', 'views', 'admin', p);
const ler = (p) => fs.readFileSync(V(p), 'utf8');
const h1 = (p) => (ler(p).match(/<h1 class="adm-h1">([^<]+)<\/h1>/) || [])[1];

test('Turmas: as abas são só os filtros de status (sem o atalho para Matrícula rápida)', () => {
  assert.doesNotMatch(ler('abas-turmas.ejs'), /href="\/matricula-rapida"/);
});

test('Matrícula rápida e Mapa de horários: sem as abas de Turmas e sem a troca entre as duas; título próprio', () => {
  for (const [f, titulo] of [['matricula-rapida.ejs', 'Matrícula rápida'], ['horarios.ejs', 'Mapa de horários']]) {
    assert.doesNotMatch(ler(f), /include\('abas-turmas'|include\('abas-matricula-rapida'/, f);
    assert.equal(h1(f), titulo, f);
  }
  assert.equal(fs.existsSync(V('abas-matricula-rapida.ejs')), false);
});

test('Configurações: cada página com o próprio título, sem as abas que repetem o menu', () => {
  for (const [f, titulo] of [['dev-usuarios.ejs', 'Usuários do painel'], ['dev-permissoes.ejs', 'Permissões'], ['banimentos.ejs', 'Alunos banidos'], ['suspeitos.ejs', 'Suspeitos']]) {
    assert.doesNotMatch(ler(f), /include\('abas-config'/, f);
    assert.equal(h1(f), titulo, f);
  }
  assert.equal(fs.existsSync(V('abas-config.ejs')), false);
});

test('Cupons aberto pelo modo Presencial continua no Presencial (não pula para o Online)', () => {
  const ead = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'ead.js'), 'utf8');
  assert.match(ead, /req\.path\.startsWith\('\/cupons'\)[^\n]*req\.session\.modoPainel === 'online'/);
});

test('Mensagem de boas-vindas: "Voltar" só quando veio de uma turma; sem o aviso de Certificados', async () => {
  const ejs = require('ejs');
  const pq = require('../src/lib/boas-vindas');
  const locais = (voltar) => ({ ativo: 'boas-vindas', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'x', usuario: { nome: 'Dev' }, asset: (u) => u,
    montarMenu: require('../src/lib/menu-painel').montarMenu, modelo: { texto: 't', doacao: 'd', local: 'l' }, padroes: pq.PADROES, voltar, ok: null, cursos: [], textosCursos: {}, cursoEditando: null });
  const sem = await ejs.renderFile(V('modelos.ejs'), locais(null));
  const main = sem.slice(sem.indexOf('<main'));
  assert.doesNotMatch(main, /Voltar<\/a>/);
  assert.doesNotMatch(main, /href="\/turmas"/);
  assert.doesNotMatch(main, /href="\/certificados"/);
  const com = await ejs.renderFile(V('modelos.ejs'), locais('/turmas/abc/boas-vindas'));
  assert.match(com, /<a href="\/turmas\/abc\/boas-vindas" class="adm-link"><i class="fa-solid fa-arrow-left"><\/i> Voltar à turma<\/a>/);
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.match(rota, /voltar: VOLTAR_MODELOS\.test\(String\(req\.query\.voltar \|\| ''\)\) \? req\.query\.voltar : null,/);
});

test('Boas-vindas num lugar só: botão sai da linha da turma; envio por turma na página Mensagem de boas-vindas', async () => {
  assert.doesNotMatch(ler('turmas.ejs'), /\/boas-vindas"/);
  const tv = ler('turma-boas-vindas.ejs');
  assert.match(tv, /include\('header', \{ ativo: 'boas-vindas' \}\)/);
  assert.match(tv, /<a href="\/modelos" class="adm-link"><i class="fa-solid fa-arrow-left"><\/i> Mensagem de boas-vindas<\/a>/);
  const ejs = require('ejs');
  const html = await ejs.renderFile(V('modelos.ejs'), {
    ativo: 'boas-vindas', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'x', usuario: { nome: 'Dev' }, asset: (u) => u,
    montarMenu: require('../src/lib/menu-painel').montarMenu, modelo: { texto: 't', doacao: 'd', local: 'l' }, padroes: require('../src/lib/boas-vindas').PADROES,
    voltar: null, ok: null, cursos: [], textosCursos: {}, cursoEditando: null,
    turmasEnvio: [
      { id: 't1', curso: 'Bombeiro Civil', inicio: '2026-12-07T00:00:00Z', recebem: 28, receberam: 0, liberadaEm: null },
      { id: 't2', curso: 'Punção Venosa', inicio: '2026-12-05T00:00:00Z', recebem: 3, receberam: 3, liberadaEm: '2026-11-10T12:00:00Z' },
    ],
  });
  const sec = html.slice(html.indexOf('id="envio-turmas"'));
  assert.ok(html.indexOf('id="envio-turmas"') > 0 && html.indexOf('id="envio-turmas"') < html.indexOf('action="/modelos"'));
  assert.match(sec, /Bombeiro Civil[\s\S]*?07\/12\/2026[\s\S]*?Ainda não liberado · 28 com pagamento ok[\s\S]*?href="\/turmas\/t1\/boas-vindas"[^>]*>Abrir envio/);
  assert.match(sec, /Punção Venosa[\s\S]*?Todos os 3 receberam/);
});

require('dotenv').config();
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
test('turmasParaEnvio: só turmas em andamento, com contagem de quem recebe e de quem recebeu', { skip: temBanco ? false : 'sem banco' }, async () => {
  const bv = require('../src/lib/boas-vindas');
  const lista = await bv.turmasParaEnvio();
  assert.ok(Array.isArray(lista));
  for (const t of lista) {
    assert.ok(t.id && t.curso && t.inicio);
    assert.ok(t.receberam <= t.recebem);
  }
  const datas = lista.map((t) => new Date(t.inicio).getTime());
  assert.deepEqual(datas, [...datas].sort((a, b) => a - b));
  await require('../src/db').$disconnect();
});

test('Certificados num lugar só: botão sai da linha da turma; "Imprimir por turma" na página Certificados', async () => {
  assert.doesNotMatch(ler('turmas.ejs'), /\/certificados"/);
  const tc = ler('turma-certificados.ejs');
  assert.match(tc, /include\('header', \{ ativo: 'certificados' \}\)/);
  assert.match(tc, /<a href="\/certificados" class="adm-link"><i class="fa-solid fa-arrow-left"><\/i> Certificados<\/a>/);
  const ejs = require('ejs');
  const base = {
    ativo: 'certificados', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'x', usuario: { nome: 'Dev' }, asset: (u) => u,
    montarMenu: require('../src/lib/menu-painel').montarMenu, ok: null, erro: null,
    ajustes: { assinantes: [], livro: 1, assinaturaOnline: 'com' },
  };
  const html = await ejs.renderFile(V('certificados.ejs'), { ...base, turmasCert: { lista: [
    { id: 't1', curso: 'Primeiros Socorros Básico', inicio: '2026-11-17T00:00:00Z', situacao: 'andamento', alunos: 28 },
    { id: 't2', curso: 'Bombeiro Civil', inicio: '2026-09-01T00:00:00Z', situacao: 'concluida', alunos: 12 },
  ], escondidas: 5, todas: false } });
  const i = html.indexOf('id="imprimir-turmas"');
  assert.ok(i > 0 && i < html.indexOf('action="/certificados?'));
  const sec = html.slice(i);
  assert.match(sec, /Primeiros Socorros Básico[\s\S]*?17\/11\/2026[\s\S]*?Em andamento[\s\S]*?28[\s\S]*?href="\/turmas\/t1\/certificados"[^>]*>Abrir certificados/);
  assert.match(sec, /Bombeiro Civil[\s\S]*?Concluída/);
  assert.match(sec, /<a href="\/certificados\?todas=1#imprimir-turmas"[^>]*>Ver mais 5 turmas concluídas<\/a>/);
  const vazio = await ejs.renderFile(V('certificados.ejs'), { ...base, turmasCert: { lista: [], escondidas: 0, todas: false } });
  assert.match(vazio, /Nenhuma turma em andamento ou concluída\./);
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.match(rota.slice(rota.indexOf("router.get('/certificados'"), rota.indexOf("router.get('/certificados'") + 500), /certificado\.turmasParaImprimir\(\{ todas: req\.query\.todas === '1' \}\)/);
});

test('turmasParaImprimir: em andamento primeiro, depois concluídas (mais recente primeiro), limite de 30', { skip: temBanco ? false : 'sem banco' }, async () => {
  const cert = require('../src/lib/certificado');
  const r = await cert.turmasParaImprimir({ todas: false });
  assert.ok(Array.isArray(r.lista) && typeof r.escondidas === 'number');
  const sit = r.lista.map((t) => t.situacao);
  assert.deepEqual(sit, [...sit].sort((a, b) => (a === 'andamento' ? 0 : 1) - (b === 'andamento' ? 0 : 1)));
  const conc = r.lista.filter((t) => t.situacao === 'concluida').map((t) => new Date(t.inicio).getTime());
  assert.deepEqual(conc, [...conc].sort((a, b) => b - a));
  assert.ok(r.lista.filter((t) => t.situacao === 'concluida').length <= 30);
  await require('../src/db').$disconnect();
});

test('prévia do certificado (página Certificados) tem o botão que o script procura — sem erro de JavaScript', () => {
  const v = ler('certificado-imprimir.ejs');
  const bloco = v.slice(v.indexOf("typeof previaPainel !== 'undefined' && previaPainel"), v.indexOf('<% } else { -%>', v.indexOf("typeof previaPainel !== 'undefined' && previaPainel")));
  assert.match(bloco, /<button type="button" id="certImprimir" hidden><\/button>/);
});
