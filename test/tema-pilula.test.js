// 2026-11-13: no menu do celular, os botões de tema (claro/automático/escuro) esticam e o arredondamento "50%"
// virava uma elipse achatada no selecionado. Agora é pílula. Chromium (Playwright) com header.ejs e admin.css reais.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* pula */ }
const RAIZ = path.join(__dirname, '..', 'src');

test('botões de tema em pílula (nunca elipse), no menu do celular e na barra lateral do computador', { skip: chromium ? false : 'sem Playwright' }, async () => {
  const header = await ejs.renderFile(path.join(RAIZ, 'views', 'admin', 'header.ejs'), { ativo: 'turmas', modoPainel: 'presencial', admPapel: 'DEV', pode: () => true, csrfToken: 't', usuario: { nome: 'Dev' }, montarMenu: require('../src/lib/menu-painel').montarMenu });
  const html = `<!doctype html><html data-tema-pref="claro"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fs.readFileSync(path.join(RAIZ, 'public', 'admin.css'), 'utf8')}</style></head><body class="adm">${header}</main></body></html>`;
  const b = await chromium.launch();
  try {
    for (const largura of [390, 1280]) {
      const p = await b.newPage({ viewport: { width: largura, height: 800 } });
      await p.setContent(html);
      const r = await p.$$eval('#admTema button', (l) => l.map((e) => { const q = e.getBoundingClientRect(); return { w: q.width, h: q.height, raio: getComputedStyle(e).borderTopLeftRadius }; }));
      for (const x of r) {
        if (x.w > x.h + 1) assert.ok(parseFloat(x.raio) >= x.h / 2 && !String(x.raio).includes('%') && !String(x.raio).includes(' '), `${largura}px: raio ${x.raio} em ${x.w}x${x.h}`);
        else assert.ok(parseFloat(x.raio) >= x.h / 2 - 0.5, `${largura}px: botão quadrado deveria ser redondo (${x.raio})`);
      }
      await p.close();
    }
  } finally { await b.close(); }
});
