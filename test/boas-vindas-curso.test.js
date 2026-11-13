// 2026-11-13: texto de boas-vindas por curso (spec docs/superpowers/specs/2026-11-13-menu-submenus-design.md §3).
require('dotenv').config();
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const bv = require('../src/lib/boas-vindas');

const turma = (curso = {}) => ({
  curso: { id: 'c1', nome: 'Bombeiro Civil', ...curso }, aulas: [{ data: '2026-12-07T00:00:00Z', horario: '' }], inicioPrevisto: '2026-12-07T00:00:00Z',
});
const modelo = { texto: 'PADRÃO {curso} {data} às {hora} {doacao}', doacao: 'doe sabão', local: 'Praça' };

test('montarTexto usa o texto do curso; sem horário some " às {hora}"', () => {
  const t = bv.montarTexto(turma({ boasVindasTexto: 'Oi {curso} dia {data} às {hora}' }), modelo);
  assert.equal(t, 'Oi Bombeiro Civil dia 07/12/2026');
});

test('sem texto do curso continua o padrão', () => {
  assert.equal(bv.montarTexto(turma(), modelo), 'PADRÃO Bombeiro Civil 07/12/2026 doe sabão');
});

test('doação da turma vale também no texto do curso', () => {
  const t = { ...turma({ boasVindasTexto: 'Curso {CURSO}: {doacao}' }), boasVindasDoacao: 'traga brinquedo' };
  assert.equal(bv.montarTexto(t, modelo), 'Curso BOMBEIRO CIVIL: traga brinquedo');
});

test('todo lugar que monta o texto carrega antes o texto do curso', () => {
  const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const lib = ler('src/lib/boas-vindas.js');
  const corpo = (nome) => lib.slice(lib.indexOf(`async function ${nome}(`), lib.indexOf('\n}\n', lib.indexOf(`async function ${nome}(`)));
  assert.match(corpo('carregarTurma'), /anexarTextosCursos\(/);
  assert.match(corpo('enviarPendentes'), /anexarTextosCursos\(/);
  const painel = ler('src/routes/painel.js');
  assert.match(painel.slice(painel.indexOf('boasVindas.lerModelo()') - 400, painel.indexOf('boasVindas.lerModelo()')), /anexarTextosCursos\(/);
  const admin = ler('src/routes/admin.js');
  const f = admin.slice(admin.indexOf('async function carregarTurmaBoasVindas('), admin.indexOf('\n}\n', admin.indexOf('async function carregarTurmaBoasVindas(')));
  assert.match(f, /anexarTextosCursos\(/);
  assert.match(admin, /router\.post\('\/modelos\/curso', requirePermissao\('turmas:gerenciar'\)/);
});

const V = (p) => path.join(__dirname, '..', 'src', 'views', 'admin', p);
const locais = (x) => ({
  ativo: 'boas-vindas', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 'x', usuario: { nome: 'Dev' },
  asset: (u) => u, montarMenu: require('../src/lib/menu-painel').montarMenu, ...x,
});

test('página Mensagem de boas-vindas: "Texto por curso" depois do padrão, com a situação de cada curso', async () => {
  const html = await ejs.renderFile(V('modelos.ejs'), locais({
    modelo, padroes: bv.PADROES, voltar: '/turmas', ok: null,
    cursos: [{ id: 'c1', nome: 'Bombeiro Civil' }, { id: 'c2', nome: 'Primeiros Socorros' }], textosCursos: { c1: 'Texto do bombeiro' }, cursoEditando: null,
  }));
  assert.ok(html.indexOf('id="texto-curso"') > html.indexOf('action="/modelos"'));
  const sec = html.slice(html.indexOf('id="texto-curso"'));
  assert.match(sec, /Bombeiro Civil[\s\S]*?Texto próprio[\s\S]*?href="\/modelos\?curso=c1#texto-curso"[^>]*>Editar[\s\S]*?Voltar ao padrão/);
  assert.match(sec, /Primeiros Socorros[\s\S]*?Padrão[\s\S]*?href="\/modelos\?curso=c2#texto-curso"[^>]*>Escrever texto do curso/);
  assert.match(sec, /<form method="POST" action="\/modelos\/curso"[^>]*data-confirmar=[\s\S]*?name="cursoId" value="c1"/);
});

test('editor do texto de um curso', async () => {
  const html = await ejs.renderFile(V('modelos.ejs'), locais({
    modelo, padroes: bv.PADROES, voltar: '/turmas', ok: null,
    cursos: [{ id: 'c1', nome: 'Bombeiro Civil' }], textosCursos: {}, cursoEditando: { id: 'c1', nome: 'Bombeiro Civil' },
  }));
  const sec = html.slice(html.indexOf('id="texto-curso"'));
  assert.match(sec, /<form method="POST" action="\/modelos\/curso"[\s\S]*?name="cursoId" value="c1"[\s\S]*?<textarea name="texto"[^>]*>PADRÃO \{curso\}/);
  assert.match(sec, /Bombeiro Civil/);
});

test('tela de Boas-vindas da turma diz qual texto vale', () => {
  const v = fs.readFileSync(V('turma-boas-vindas.ejs'), 'utf8');
  assert.match(v, /turma\.curso\.boasVindasTexto/);
  assert.match(v, /Texto próprio do curso/);
  assert.match(v, /Texto padrão/);
  assert.match(v, /href="\/modelos\?curso=<%= turma\.curso\.id %>#texto-curso"/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('texto por curso no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const id = 'teste-bv-curso-' + Date.now();
  after(async () => { await prisma.configuracao.deleteMany({ where: { chave: `extra:curso:${id}` } }); await prisma.$disconnect(); });

  test('salvar, ler, anexar e apagar (vazio ou igual ao padrão)', async () => {
    await bv.salvarTextoCurso(id, 'Texto X');
    assert.equal((await bv.lerTextosCursos())[id], 'Texto X');
    const t = { curso: { id } };
    await bv.anexarTextosCursos([t]);
    assert.equal(t.curso.boasVindasTexto, 'Texto X');
    await bv.salvarTextoCurso(id, '');
    assert.equal((await bv.lerTextosCursos())[id], undefined);
    await bv.salvarTextoCurso(id, 'Y');
    await bv.salvarTextoCurso(id, (await bv.lerModelo()).texto);
    assert.equal((await bv.lerTextosCursos())[id], undefined);
  });
});
