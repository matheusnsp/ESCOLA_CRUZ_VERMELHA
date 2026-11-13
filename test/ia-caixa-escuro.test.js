// 2026-11-13: a caixa "Escrever com IA" (e a de dúvidas) acompanha o modo escuro, sem fundo claro fixo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'public', 'admin.css'), 'utf8');

const regra = (sel) => { const m = new RegExp(`(^|\\n)\\s*${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css); return m ? m[2] : ''; };

test('caixas da IA e cartões de dúvida usam variáveis do tema, não cores claras fixas', () => {
  for (const sel of ['.ia-textos', '.ia-duvidas', '.ia-faq']) {
    const r = regra(sel);
    assert.ok(r, `regra ${sel} existe`);
    assert.doesNotMatch(r, /background:\s*#/, `${sel} sem fundo fixo`);
    assert.match(r, /background:\s*var\(--/, `${sel} com fundo do tema`);
  }
  assert.match(regra('.ia-textos-cab > i'), /color:\s*var\(--roxo-tx\)/);
  assert.match(regra('.ia-textos-msg'), /color:\s*var\(--ok-tx\)/);
});

test('modo escuro define o fundo da caixa da IA', () => {
  const escuro = /html\[data-tema="escuro"\]\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(escuro, /--ia-bg:\s*#/);
  assert.match(css.split('html[data-tema="escuro"]')[0], /--ia-bg:\s*#fbf9ff/);
});
