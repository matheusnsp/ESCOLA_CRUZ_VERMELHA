// 2026-11-13: no Safari os campos da aba Certificados vazavam dos cartões (largura mínima dos inputs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'public', 'admin.css'), 'utf8');

test('cartões da aba Certificados deixam os campos encolher (min-width: 0 e largura 100%)', () => {
  assert.match(css, /\.adm-cert-cartao > \*[^{]*\{ min-width: 0; \}/);
  assert.match(css, /\.adm-cert-cartao input\[type=text\], \.adm-cert-cartao input\[type=file\] \{ width: 100%; min-width: 0;/);
});
