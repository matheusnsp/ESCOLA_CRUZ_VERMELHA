// 2026-11-13: no celular, o valor "R$ 6.595,80" da Matrícula rápida saía do bloco (três blocos lado a lado).
// Chromium (Playwright) com o admin.css de verdade; sem Playwright, pula.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* pula */ }
const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'admin.css'), 'utf8');

test('Matrícula rápida: números do topo cabem no bloco em 320–430 px', { skip: chromium ? false : 'sem Playwright' }, async () => {
  const b = await chromium.launch();
  try {
    for (const largura of [320, 375, 390, 430]) {
      const p = await b.newPage({ viewport: { width: largura, height: 800 } });
      await p.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body class="adm"><main class="adm-wrap">
        <section class="mr-topo"><div class="mr-topo-txt"><b>Matrícula rápida</b></div><div class="mr-topo-nums">
          <a class="mr-num warn"><b>3</b><span>aguardando encaixe</span></a>
          <a class="mr-num ok"><b>49</b><span>já em turma</span></a>
          <div class="mr-num"><b>R$ 16.595,80</b><span>147 inscrição(ões) paga(s)</span></div>
        </div></section></main></body></html>`);
      const ruins = await p.$$eval('.mr-num', (l) => l.map((n) => {
        const caixa = n.getBoundingClientRect();
        return [...n.children].filter((f) => { const r = f.getBoundingClientRect(); return r.right > caixa.right + 0.5 || f.scrollWidth > f.clientWidth + 1; }).map((f) => f.textContent);
      }).flat());
      assert.deepEqual(ruins, [], `${largura}px: ${ruins.join(', ')}`);
      const pagina = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.equal(pagina, true, `${largura}px: rolagem lateral`);
      await p.close();
    }
  } finally { await b.close(); }
});
