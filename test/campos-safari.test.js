// 2026-11-13: no Safari do celular, campos de texto/listas têm largura mínima própria e saíam da caixa nos formulários
// do painel (o mesmo caso do Certificados, PR #133, agora em todos os formulários).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'public', 'admin.css'), 'utf8');

test('formulários do painel deixam os campos encolher até a largura da coluna', () => {
  assert.match(css, /\.adm-form > \*, \.adm-form label, \.adm-campo, \.adm-filtros > \* \{ min-width: 0; \}/);
  assert.match(css, /\.adm-form :is\(input:not\(\[type=checkbox\]\):not\(\[type=radio\]\), select, textarea\),\s*\.adm-campo :is\(input, select\) \{ width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; \}/);
});

test('site dos alunos: Entrar/Criar conta e Minha conta/Completar dados também deixam os campos encolher', () => {
  const ler = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'public', f), 'utf8');
  assert.match(ler('auth.css'), /\.auth-field, \.auth-form-grid > \* \{ min-width: 0; \}\s*\.auth-field input, \.auth-field select \{ min-width: 0; max-width: 100%; box-sizing: border-box; \}/);
  assert.match(ler('site-extra.css'), /\.ct-form > \*, \.ct-campo \{ min-width: 0; \}\s*\.ct-campo input, \.ct-campo select \{ width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; \}/);
});
