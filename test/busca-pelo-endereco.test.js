// 2026-11-13: Financeiro e Matrícula rápida aceitam ?q= (o assistente da secretaria leva para a tela já filtrada).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const rota = (r) => { const a = ler('routes/admin.js'); const i = a.indexOf(`router.get('${r}'`); return a.slice(i, a.indexOf('\nrouter.', i + 10)); };

test('Financeiro: ?q= preenche a busca e a lista já abre filtrada', () => {
  assert.match(rota('/financeiro'), /qBusca: String\(req\.query\.q \|\| ''\)\.trim\(\)\.slice\(0, 100\)/);
  assert.match(ler('views/admin/financeiro.ejs'), /id="finBusca" value="<%= typeof qBusca !== 'undefined' \? qBusca : '' %>"/);
});

test('Matrícula rápida: ?q= preenche a busca, filtra ao abrir e continua ao trocar o curso', () => {
  assert.match(rota('/matricula-rapida'), /qBusca: String\(req\.query\.q \|\| ''\)\.trim\(\)\.slice\(0, 100\)/);
  const v = ler('views/admin/matricula-rapida.ejs');
  assert.match(v, /<input type="search" id="mrBusca" name="q" value="<%= typeof qBusca !== 'undefined' \? qBusca : '' %>"/);
  assert.match(v, /if \(campo\.value\) campo\.dispatchEvent\(new Event\('input'\)\);/);
});
