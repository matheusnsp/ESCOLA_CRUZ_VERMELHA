// Etapa 8 (pedido do Matheus): os links do curso online usam o nome do curso, como o presencial
// (/online/primeiros-socorros-na-escola em vez de /online/<id>). O endereço com o id continua valendo e redireciona.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const vitrine = require('../src/lib/vitrine');

test('urlOnline: o nome do curso no endereço', () => {
  assert.equal(vitrine.urlOnline({ nome: 'Primeiros Socorros na Escola (demonstração)' }), '/escola-digital/primeiros-socorros-na-escola-demonstracao');
});

test('renomear no presencial e ativar o EAD conferem o endereço do curso online', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.match(admin, /enderecoOnlineEmUso\(/);
  assert.match(admin, /guardarEnderecoAntigo\(/);
  const ead = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'ead.js'), 'utf8');
  assert.match(ead, /enderecoOnlineEmUso\(/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ead-curso-online.js'), 'utf8'), /guardarEnderecoAntigo\(/);
});

test('nenhum link do curso online é montado com o id do curso', () => {
  const arquivos = [
    'src/views/partials/v-card-cat.ejs', 'src/views/partials/caixa-online.ejs', 'src/views/minha-conta.ejs',
    'src/lib/ead-duvidas.js', 'src/lib/ead-lote.js', 'src/lib/ead-meus-cursos.js', 'src/lib/ead-medicao.js',
    'src/lib/cobranca-avista.js', 'src/lib/status-pagamento.js', 'src/routes/ead.js', 'src/routes/cursos.js', 'src/routes/ead-escola.js',
  ];
  for (const a of arquivos) {
    const src = fs.readFileSync(path.join(__dirname, '..', a), 'utf8');
    assert.doesNotMatch(src, /\/online\/(\$\{|' \+ |<%= )[^`'"\n]*(cursoId|curso\.id|c\.id)\b/, a);
  }
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('links do curso online pelo nome', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { meusCursosOnline } = require('../src/lib/ead-meus-cursos');
  const { destinoAposPagamento } = require('../src/lib/cobranca-avista');
  const s = String(Date.now()).slice(-7);
  let server; let site; let curso; let co; let turma; let aluno; let slug;

  let restaurarEd; // Escola Digital começa desligada (2026-11): liga para o teste e devolve no fim

  before(async () => { restaurarEd = await require('./helpers/escola-digital').ligarEscolaDigital(); });

  after(async () => { if (restaurarEd) await restaurarEd(); });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Primeiros Passos Link ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    slug = `primeiros-passos-link-${s}`;
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 30, publicado: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
    aluno = await prisma.usuario.create({ data: { nome: 'Aluna Link', email: `al-link-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 30, valorTaxaMatricula: 0, statusPagamento: 'PAGO', taxaConfirmada: true, confirmadaEm: new Date(Date.now() - 3 * 864e5) } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { Object.assign(res.locals, { csrfToken: 'x', isAdmin: false }); next(); });
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.usuario.delete({ where: { id: aluno.id } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'ead-endereco:primeiros-passos-' } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('o endereço com o nome abre a capa', async () => {
    const r = await fetch(`${site}/online/${slug}`, { redirect: 'manual' });
    assert.equal(r.status, 200);
  });

  test('o endereço com o id continua abrindo e aponta (canonical) para o endereço com o nome', async () => {
    const r = await fetch(`${site}/online/${curso.id}`, { redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.match(await r.text(), new RegExp(`<link rel="canonical" href="[^"]*/escola-digital/${slug}">`));
    const t = await (await fetch(`${site}/online/${slug}`)).text();
    assert.match(t, new RegExp(`<link rel="canonical" href="[^"]*/escola-digital/${slug}">`));
  });

  test('Minha conta e o retorno do pagamento levam ao endereço com o nome', async () => {
    const [item] = await meusCursosOnline(aluno.id);
    assert.equal(item.link, `/escola-digital/${slug}/continuar`);
    assert.equal(item.endereco, `/escola-digital/${slug}`);
    assert.equal(destinoAposPagamento({ turma: { status: 'ONLINE', cursoId: curso.id, curso: { nome: curso.nome } } }), `/escola-digital/${slug}`);
  });

  test('[revisão I2] curso renomeado: o endereço antigo continua levando ao curso', async () => {
    const acesso = require('../src/lib/ead-acesso');
    await acesso.guardarEnderecoAntigo(curso.id, curso.nome, `Primeiros Passos Novo ${s}`);
    assert.equal(await acesso.cursoOnlineDoEndereco(slug), co.id);
    const r = await fetch(`${site}/online/${slug}`, { redirect: 'manual' });
    assert.equal(r.status, 200);
    await prisma.configuracao.deleteMany({ where: { chave: `ead-endereco:${slug}` } });
  });

  test('[revisão I3] nome que bate com o endereço de outro curso online é recusado', async () => {
    const acesso = require('../src/lib/ead-acesso');
    assert.equal(await acesso.enderecoOnlineEmUso(`Primeiros passos — Link ${s}!`), true);
    assert.equal(await acesso.enderecoOnlineEmUso(`Primeiros passos — Link ${s}!`, curso.id), false, 'o próprio curso não conta');
    assert.equal(await acesso.enderecoOnlineEmUso(`Outro Nome ${s}`), false);
  });
});
