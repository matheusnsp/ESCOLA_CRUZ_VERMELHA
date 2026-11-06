// Rotas do link de teste (/ead-teste): os 404 não podem carregar Analytics/Pixel (o endereço tem o
// código secreto) e nada abaixo de /ead-teste pode seguir para a contagem de visitas ou o 404 do site.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('/ead-teste: 404 sem rastreamento', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  let server; let base; let passouAdiante = 0;
  before(async () => {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use((req, res, next) => { res.locals.csrfToken = 'x'; res.locals.isAdmin = false; next(); });
    app.use(require('../src/routes/ead-teste'));
    app.use((req, res) => { passouAdiante++; res.status(404).render('erro', { mensagem: 'Página não encontrada.' }); });
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server.close(); await require('../src/db').$disconnect(); });

  const CODIGO_FALSO = 'A'.repeat(43);
  for (const caminho of ['/ead-teste/abc', `/ead-teste/${CODIGO_FALSO}`, `/ead-teste/${CODIGO_FALSO}/modulo/x`, `/ead-teste/${CODIGO_FALSO}/qualquer/coisa`, '/ead-teste']) {
    test(`${caminho} → 404 sem gtag/fbq e sem seguir adiante`, async () => {
      const antes = passouAdiante;
      const r = await fetch(base + caminho);
      const html = await r.text();
      assert.equal(r.status, 404);
      assert.doesNotMatch(html, /gtag|googletagmanager|fbq|fbevents/);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(passouAdiante, antes, 'a requisição seguiu para o resto do site');
    });
  }
});
