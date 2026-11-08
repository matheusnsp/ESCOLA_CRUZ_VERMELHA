// Escola Digital (2026-11), Task 5: painel mais fácil (vistoria P2, P4, P5, P7, P8).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('o aviso de confirmação envia o botão clicado e usa a cor da ação', () => {
  const h = ler('src/views/admin/header.ejs');
  assert.match(h, /e\.submitter/);
  assert.match(h, /confirmarTipo/);
});

test('Validar e Publicar confirmam com o botão verde', () => {
  assert.match(ler('src/views/admin/ead/modulo.ejs'), /\/validar" data-confirmar="[^"]*" data-botao="Validar" data-confirmar-tipo="ok"/);
  assert.match(ler('src/views/admin/ead/curso.ejs'), /data-botao="Publicar" data-confirmar-tipo="ok"/);
});

test('campos do painel não passam da borda no celular', () => {
  assert.match(ler('src/public/ead-admin.css'), /\.adm-campos > \*[^{]*\{[^}]*min-width:\s*0/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('página do curso no painel', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  let srv; let co;
  before(async () => {
    const c = await prisma.curso.create({ data: { nome: `Curso Painel UX ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: c.id } });
    srv = await ouvir(montarPainel(`dev-ux-${s}`));
  });
  after(async () => { srv.server.close(); await apagarCursosOnline(prisma, [co.id]); await prisma.$disconnect(); });
  const post = (u, campos) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos).toString() });

  test('"Novo módulo" vem antes de "Venda no site"', async () => {
    const t = await (await fetch(`${srv.url}/ead/curso/${co.id}`)).text();
    assert.ok(t.indexOf('Novo módulo') > 0 && t.indexOf('Novo módulo') < t.indexOf('Venda no site'));
  });

  test('preço inválido volta com o valor digitado', async () => {
    const r = await post(`/ead/curso/${co.id}/preco`, { precoOnline: 'abc' });
    assert.equal(r.status, 302);
    const t = await (await fetch(srv.url + r.headers.get('location'))).text();
    assert.match(t, /name="precoOnline"[^>]*value="abc"/);
    assert.match(t, /Preço: um valor em reais/);
  });

  test('nota mínima inválida volta com o valor digitado', async () => {
    const r = await post(`/ead/curso/${co.id}`, { notaMinimaQuiz: '40' });
    const t = await (await fetch(srv.url + r.headers.get('location'))).text();
    assert.match(t, /name="notaMinimaQuiz"[^>]*value="40"/);
  });
});
