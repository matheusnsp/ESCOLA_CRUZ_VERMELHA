// Publicação do curso online (etapa 4): pendências, ligar/desligar no painel, selo no catálogo e caixa na
// página do curso. Contra o Postgres LOCAL; o painel é montado sem login (requireDev de mentira).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { urlOnline } = require('../src/lib/vitrine');
const path = require('path');
const ejs = require('ejs');
const express = require('express');

const { podePublicar } = require('../src/lib/ead-publicacao');

describe('podePublicar', () => {
  const ok = { precoOnline: 49.9, modulos: [{ titulo: 'A', status: 'VALIDADO' }] };
  test('tudo certo ⇒ sem pendências', () => assert.deepEqual(podePublicar(ok), []));
  test('sem preço (null ou 0)', () => {
    assert.deepEqual(podePublicar({ ...ok, precoOnline: null }), ['Defina o preço do curso online.']);
    assert.deepEqual(podePublicar({ ...ok, precoOnline: 0 }), ['Defina o preço do curso online.']);
  });
  test('sem módulos', () => assert.deepEqual(podePublicar({ ...ok, modulos: [] }), ['O curso não tem módulos.']));
  test('módulo em rascunho, um por linha, junto com o preço', () => {
    assert.deepEqual(podePublicar({ precoOnline: null, modulos: [{ titulo: 'A', status: 'VALIDADO' }, { titulo: 'B', status: 'RASCUNHO' }] }),
      ['Defina o preço do curso online.', 'Módulo "B" em rascunho.']);
  });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('painel: publicar e site', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const auditoria = [];
  let server; let painel; let curso; let co; let mod;

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE publicar online', cargaHoraria: 2, precoAvista: 200, precoCheio: 200, valorParcela: 200, ativo: true } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    mod = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Único', ordem: 0 } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => {
      req.session = { usuarioId: null };
      Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev Teste', papel: 'DEV' } });
      next();
    });
    app.use(require('../src/routes/ead')({
      requireDev: (req, res, next) => next(),
      auditar: async (req, acao, alvo, alvoId, dados) => { auditoria.push({ acao, alvoId, dados }); },
      ADMIN_URL: '',
    }));
    await new Promise((r) => { server = app.listen(0, r); });
    painel = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const post = (url, corpo) => fetch(painel + url, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const publicado = async () => (await prisma.cursoOnline.findUnique({ where: { id: co.id } })).publicado;

  test('preço: aceita "49,90"; recusa vazio, zero e texto', async () => {
    for (const ruim of ['', '0', 'abc', '-5']) {
      const r = await post(`/ead/curso/${co.id}/preco`, { precoOnline: ruim });
      assert.match(r.headers.get('location'), /erro=/);
    }
    assert.equal((await prisma.cursoOnline.findUnique({ where: { id: co.id } })).precoOnline, null);
    const r = await post(`/ead/curso/${co.id}/preco`, { precoOnline: '49,90' });
    assert.match(r.headers.get('location'), /ok=/);
    assert.equal(Number((await prisma.cursoOnline.findUnique({ where: { id: co.id } })).precoOnline), 49.9);
  });

  test('ligar com módulo em rascunho ⇒ erro com a pendência e nada gravado', async () => {
    const r = await post(`/ead/curso/${co.id}/publicar`, { acao: 'ligar' });
    assert.match(decodeURIComponent(r.headers.get('location')), /Módulo "Único" em rascunho/);
    assert.equal(await publicado(), false);
    assert.equal(auditoria.filter((a) => a.acao === 'EAD_PUBLICOU').length, 0);
  });

  test('ligar sem pendências ⇒ publicado e auditoria EAD_PUBLICOU', async () => {
    await prisma.moduloEad.update({ where: { id: mod.id }, data: { status: 'VALIDADO' } });
    const r = await post(`/ead/curso/${co.id}/publicar`, { acao: 'ligar' });
    assert.match(r.headers.get('location'), /ok=/);
    assert.equal(await publicado(), true);
    assert.equal(auditoria.filter((a) => a.acao === 'EAD_PUBLICOU' && a.alvoId === co.id).length, 1);
  });

  test('site: selo e caixa só com o curso publicado', async () => {
    const { cursosOnlinePublicados } = require('../src/lib/ead-publicacao');
    const mapa = await cursosOnlinePublicados();
    assert.equal(mapa.get(curso.id), 49.9);
    const vitrine = require('../src/lib/vitrine');
    const locais = { vitrine, taxaExibicao: () => 0, cfgMap: {}, urlCurso: vitrine.urlCurso };
    const cartao = (online) => ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'partials', 'v-card-cat.ejs'), { ...locais, curso: { ...curso, turmas: [], online } });
    assert.match(await cartao({ preco: 49.9 }), /100% online/);
    assert.doesNotMatch(await cartao(null), /100% online/);
    const card = (online) => ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'partials', 'v-card.ejs'), { ...locais, largura: 4, curso: { ...curso, turmas: [], online } });
    assert.match(await card({ preco: 49.9 }), /100% online/);
    assert.doesNotMatch(await card(null), /100% online/);
    const caixa = (online) => ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'partials', 'caixa-online.ejs'), { vitrine, curso: { ...curso, online } });
    const html = await caixa({ preco: 49.9 });
    assert.match(html, /Também 100% online/); assert.match(html, /R\$\s?49,90/); assert.match(html, new RegExp(`href="${urlOnline(curso)}"`));
    assert.equal((await caixa(null)).trim(), '');
  });

  test('aviso no painel: publicado com módulo que voltou a rascunho', async () => {
    const { avisoPublicado } = require('../src/lib/ead-publicacao');
    await prisma.moduloEad.update({ where: { id: mod.id }, data: { status: 'RASCUNHO' } });
    const coAtual = await prisma.cursoOnline.findUnique({ where: { id: co.id }, include: { modulos: true } });
    assert.equal(avisoPublicado(coAtual), 'Curso publicado com módulo em rascunho: o aluno já vê a versão nova. Revise e valide de novo.');
    const html = await (await fetch(`${painel}/ead/curso/${co.id}`)).text();
    assert.match(html, /Curso publicado com módulo em rascunho/);
  });

  test('desativar EAD: recusa com o curso no site e com aluno inscrito', async () => {
    await prisma.moduloEad.update({ where: { id: mod.id }, data: { status: 'RASCUNHO' } });
    const r = await post(`/ead/curso/${co.id}/desativar`, {});
    assert.match(decodeURIComponent(r.headers.get('location')), /Tire o curso do site/);
    assert.ok(await prisma.cursoOnline.findUnique({ where: { id: co.id } }));
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: false } });
    const { turmaOnline } = require('../src/lib/turma-online');
    const t = await turmaOnline(co);
    const u = await prisma.usuario.create({ data: { nome: 'Aluno Desativar', email: `desat-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: t.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, statusPagamento: 'PAGO' } });
    try {
      const r2 = await post(`/ead/curso/${co.id}/desativar`, {});
      assert.match(decodeURIComponent(r2.headers.get('location')), /já tem alunos inscritos/);
      assert.ok(await prisma.cursoOnline.findUnique({ where: { id: co.id } }));
    } finally {
      await prisma.matricula.delete({ where: { id: m.id } }); await prisma.usuario.delete({ where: { id: u.id } }); await prisma.turma.delete({ where: { id: t.id } });
      await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: true } });
    }
  });

  test('desligar ⇒ despublicado, EAD_DESPUBLICOU, e sai do catálogo', async () => {
    const r = await post(`/ead/curso/${co.id}/publicar`, { acao: 'desligar' });
    assert.match(r.headers.get('location'), /ok=/);
    assert.equal(await publicado(), false);
    assert.equal(auditoria.filter((a) => a.acao === 'EAD_DESPUBLICOU').length, 1);
    const { cursosOnlinePublicados } = require('../src/lib/ead-publicacao');
    assert.equal((await cursosOnlinePublicados()).has(curso.id), false);
    // quem já pagou continua entrando: test/ead-online.test.js ("curso despublicado: quem pagou continua")
  });
});
