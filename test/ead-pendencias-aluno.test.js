// Etapa 8: pendências que o aluno vê (cancelados na aba Cursos online, cupom inválido, textos da capa,
// nome público com agnome, 20 dúvidas por aula, equipe da "Minha escola" no celular). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { urlOnline } = require('../src/lib/vitrine');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cpf = require('./helpers/cpf');

const { nomePublico } = require('../src/lib/ead-duvidas');

test('nome público ignora agnomes no sobrenome', () => {
  assert.equal(nomePublico('João Silva Neto'), 'João S.');
  assert.equal(nomePublico('maria souza filho'), 'Maria S.');
  assert.equal(nomePublico('Pedro Alves Júnior'), 'Pedro A.');
  assert.equal(nomePublico('Paulo Reis junior'), 'Paulo R.');
  assert.equal(nomePublico('Luís Prado Sobrinho'), 'Luís P.');
  assert.equal(nomePublico('Dom Pedro Segundo'), 'Dom P.');
  assert.equal(nomePublico('João Neto'), 'João N.');
  assert.equal(nomePublico('Ana'), 'Ana');
});

test('"Minha escola": a tabela da equipe vira cartões no celular', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'escola', 'lote.ejs'), 'utf8');
  assert.ok((view.match(/data-rotulo="/g) || []).length >= 6);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'ead.css'), 'utf8');
  assert.match(css, /@media \(max-width: 640px\)[^}]*\.esc-tabela/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('pendências do aluno', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eadTeste = require('../src/lib/ead-teste');
  const { meusCursosOnline } = require('../src/lib/ead-meus-cursos');
  const duv = require('../src/lib/ead-duvidas');
  const s = String(Date.now()).slice(-7);
  let server; let site; let curso; let co; let turma; let tela; let codigo; let cupom100; let escola; const us = {};

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Pend ${s}`, cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 60, publicado: true, maxParcelas: 6 } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } }, include: { telas: true } });
    tela = t.telas[0];
    turma = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
    for (const n of ['Est', 'Can', 'Esc', 'Duv']) us[n] = await prisma.usuario.create({ data: { nome: `${n} Pendencia`, email: `${n.toLowerCase()}-pend-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    const mat = (u, status) => prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 60, valorTaxaMatricula: 0, statusPagamento: status } });
    await mat(us.Est, 'ESTORNADO'); await mat(us.Can, 'CANCELADO'); await mat(us.Esc, 'ESTORNADO');
    escola = await prisma.escolaEad.create({ data: { nome: `Escola Pend ${s}` } });
    const lote = await prisma.loteEad.create({ data: { escolaId: escola.id, cursoOnlineId: co.id, vagas: 2, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'OUTRO', criadoPor: 'dev' } });
    await prisma.vagaLoteEad.create({ data: { loteId: lote.id, usuarioId: us.Esc.id, origem: 'GESTOR' } });
    cupom100 = await prisma.cupomEad.create({ data: { codigo: `PEND${s}`, tipo: 'PERCENTUAL', valor: 100, criadoPor: 'dev' } });
    const ac = await prisma.alunoCursoEad.create({ data: { usuarioId: us.Duv.id, cursoOnlineId: co.id } });
    for (let i = 0; i < 25; i++) {
      await prisma.duvidaEad.create({ data: { alunoCursoId: ac.id, telaId: tela.id, texto: `Pergunta número ${i} sobre a aula`, status: 'RESPONDIDA', resposta: 'Resposta', respondidaPor: 'dev', respondidaEm: new Date(Date.now() - (25 - i) * 60e3) } });
    }
    codigo = await eadTeste.gerarCodigo(co.id);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = require('../src/lib/vitrine').urlCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = 'ALUNO'; }
      Object.assign(res.locals, { csrfToken: 'x', isAdmin: false });
      next();
    });
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    app.use(require('../src/routes/painel'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.duvidaEad.deleteMany({ where: { telaId: tela.id } });
    await prisma.alunoCursoEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.vagaLoteEad.deleteMany({ where: { lote: { cursoOnlineId: co.id } } });
    await prisma.loteEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.escolaEad.delete({ where: { id: escola.id } });
    await prisma.cupomEad.delete({ where: { id: cupom100.id } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-pend-${s}@` } } });
    await eadTeste.desligar(co.id);
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: co.id } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const pagina = (url, u, cookie) => fetch(site + url, { redirect: 'manual', headers: { ...(u ? { 'x-teste-usuario': u.id } : {}), ...(cookie ? { cookie } : {}) } });

  test('estornada e cancelada aparecem como "cancelado", no fim, com o texto', async () => {
    const [e] = await meusCursosOnline(us.Est.id);
    assert.deepEqual([e.situacao, e.link], ['cancelado', urlOnline(curso)]);
    assert.equal((await meusCursosOnline(us.Can.id))[0].situacao, 'cancelado');
    const html = await (await pagina('/minha-conta?sec=online', us.Est)).text();
    assert.match(html, /Pagamento cancelado ou devolvido: o curso fica fechado\./);
    assert.match(html, /CANCELADO/);
  });

  test('estornada + vaga de escola no mesmo curso ⇒ 1 item, pela escola', async () => {
    const l = await meusCursosOnline(us.Esc.id);
    assert.equal(l.length, 1);
    assert.equal(l[0].origem, 'escola');
  });

  test('cupom inválido: mensagem com "tirar" e não fica guardado', async () => {
    const r = await pagina(`/online/${curso.id}?cupom=NADA${s}`);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const html = await r.text();
    assert.match(html, /Cupom não encontrado\./);
    assert.match(html, new RegExp(`href="/online/${curso.id}\\?cupom="[^>]*>tirar`));
    assert.doesNotMatch(await (await pagina(`/online/${curso.id}`, null, cookie)).text(), /Cupom não encontrado/);
  });

  test('textos da capa: parcelas sem "Pagamento único"; visitante com 100% vê "Criar conta e liberar"', async () => {
    const html = await (await pagina(`/online/${curso.id}`)).text();
    assert.match(html, /À vista no PIX ou em até 6x no cartão\./);
    assert.doesNotMatch(html, /Pagamento único/);
    const gratis = await (await pagina(`/online/${curso.id}?cupom=${cupom100.codigo}`)).text();
    assert.match(gratis, /Criar conta e liberar/);
    assert.doesNotMatch(gratis, /R\$\s?0,00/);
  });

  test('dúvidas: 20 mais recentes e "Ver todas as 25 dúvidas"', async () => {
    const r = await duv.duvidasDaTela(tela.id, null);
    assert.equal(r.lista.length, 20);
    assert.equal(r.total, 25);
    assert.equal(r.lista[0].texto, 'Pergunta número 24 sobre a aula');
    assert.equal((await duv.duvidasDaTela(tela.id, null, { todas: true })).lista.length, 25);
    const html = await (await pagina(`/ead-teste/${codigo}/tela/${tela.id}`)).text();
    assert.match(html, /Ver todas as 25 dúvidas/);
    assert.equal((html.match(/class="ea-duvida /g) || []).length, 20);
    const todas = await (await pagina(`/ead-teste/${codigo}/tela/${tela.id}?duvidas=todas`)).text();
    assert.equal((todas.match(/class="ea-duvida /g) || []).length, 25);
    assert.doesNotMatch(todas, /Ver todas as/);
  });
});
