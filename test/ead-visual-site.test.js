// Área do aluno com a cara do site (2026-11-09, pedido do Matheus): o nome do header igual ao do site, o mesmo
// footer do site e nenhum bloco preto (o site não tem preto). Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'ead.css'), 'utf8');
const regra = (sel) => { const m = css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[2] : ''; };

test('CSS: topo, "A seguir", módulo final e rodapé sem fundo preto', () => {
  for (const sel of ['.ea-heroi', '.ea-seguir', '.ea-mod.final', '.ea-rodape']) {
    const r = regra(sel);
    assert.ok(r, `regra ${sel} existe`);
    assert.doesNotMatch(r, /background:\s*(#111|#000|#0b0b0b|var\(--ink\))/i, `${sel} sem preto`);
  }
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('área do aluno com header e footer do site', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const eadTeste = require('../src/lib/ead-teste');
  const s = String(Date.now()).slice(-7);
  let server; let base; let curso; let co; let m;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `TESTE visual ${s}`, cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M', ordem: 0, introducao: 'x' } });
    await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', telas: { create: [{ titulo: 't' }] } } });
    const codigo = await eadTeste.gerarCodigo(co.id);
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { res.locals.csrfToken = 'x'; next(); });
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/ead-teste/${codigo}`;
  });
  after(async () => {
    server.close();
    await eadTeste.desligar(co.id);
    await prisma.topicoEad.deleteMany({ where: { moduloId: m.id } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  test('capa e módulo: nome do header e footer iguais aos do site', async () => {
    for (const u of [base, `${base}/modulo/${m.id}`]) {
      const html = await (await fetch(u)).text();
      const header = (html.match(/<header[\s\S]*?<\/header>/) || [''])[0];
      assert.match(header, /ESCOLA DE EDUCAÇÃO/);
      assert.match(header, /E SAÚDE CVB-RJ/);
      assert.doesNotMatch(header, /CURSOS 100% ONLINE/);
      const footer = (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
      for (const t of ['Navegação', 'Contato', 'Capacitação para quem quer cuidar', 'Desenvolvido por Matheus Neves', 'Política de Privacidade', 'Site da Cruz Vermelha RJ']) assert.match(footer, new RegExp(t), t);
      assert.match(html, /Praça da Cruz Vermelha, 10 · Centro · Rio de Janeiro/, 'faixa de cima igual à do site');
    }
  });

  test('header com o mesmo menu do site, sem "Site da escola"', async () => {
    const html = await (await fetch(base)).text();
    const header = (html.match(/<header[\s\S]*?<\/header>/) || [''])[0];
    assert.doesNotMatch(header, /Site da escola/);
    for (const [href, nome] of [['/', 'Início'], ['/#como', 'Como funciona'], ['/#escola', 'Quem somos'], ['/#duvidas', 'Dúvidas'], ['/cursos', 'Ver cursos'], ['/login', 'Entrar']]) {
      assert.match(header, new RegExp(`href="${href.replace('#', '\\#')}"[^>]*>\\s*(<[^>]+>\\s*)*${nome}`), nome);
    }
    assert.match(header, /class="ea-burger"/, 'menu do celular');
    assert.doesNotMatch(html, /<script>(?![^<]*gtag)/, 'sem script inline');
  });
});

test('CSS: cartões dos módulos da mesma linha com a mesma altura (rodapé "Módulo N / Abrir" alinhado)', () => {
  assert.match(css, /\.ea-modulos > li\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.ea-modulos > li > \.ea-mod\s*\{[^}]*flex:\s*1/);
});

test('CSS: avisos (senha provisória, cadastro) e faixa de teste nas cores do site, sem laranja/amarelo', () => {
  for (const sel of ['.ea-aviso', '.ea-teste']) {
    const r = regra(sel);
    assert.ok(r, `regra ${sel} existe`);
    assert.doesNotMatch(r, /#f59e0b|#fcd94d|#fef3c7|#92400e/i, `${sel} sem laranja/amarelo`);
  }
});

test('avisos da conta no desenho do presencial: ícone, texto e botão vermelho', async () => {
  const ejs = require('ejs');
  const html = await ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'ead-teste', '_avisos.ejs'), { ctx: { avisos: { senha: true, cadastro: true } } });
  assert.match(html, /class="ea-aviso"[^>]*>\s*<i class="fa-solid fa-key"/);
  assert.match(html, /<i class="fa-solid fa-triangle-exclamation"/);
  assert.match(html, /<a class="ea-aviso-btn" href="\/minha-conta\?sec=seguranca">Trocar senha<\/a>/);
  assert.match(html, /<a class="ea-aviso-btn" href="\/completar-dados">Completar agora<\/a>/);
  assert.match(regra('.ea-aviso'), /display:\s*flex/);
  assert.match(regra('.ea-aviso'), /background:\s*#fff5f5/);
  assert.match(regra('.ea-aviso-btn'), /background:\s*var\(--r\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'ead-teste', 'capa.ejs'), 'utf8'), /ea-aviso ea-aviso-ok[\s\S]{0,400}ea-aviso-btn[\s\S]{0,120}>Ver a resposta</);
});
