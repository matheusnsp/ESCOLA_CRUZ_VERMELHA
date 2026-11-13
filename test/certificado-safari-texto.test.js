// 2026-11-13: no iPhone, a prévia do certificado (reduzida com zoom na tela pequena) ficava com o texto encavalado:
// o Safari aumenta sozinho o texto que acha pequeno (text autosizing). O certificado desliga isso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('certificado.css desliga o aumento automático de texto do Safari', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'certificado.css'), 'utf8');
  const regra = /html\s*\{[^}]*-webkit-text-size-adjust:\s*100%[^}]*\}/.exec(css);
  assert.ok(regra, 'falta html { -webkit-text-size-adjust: 100% }');
  assert.match(regra[0], /(^|[^-])text-size-adjust:\s*100%/);
});
