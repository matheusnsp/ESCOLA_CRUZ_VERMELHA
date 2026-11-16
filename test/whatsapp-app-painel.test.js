// 2026-11-16: no painel, o WhatsApp abre no APLICATIVO do computador (whatsapp://), não no WhatsApp Web. O Web fica só
// como reserva na tela intermediária (quando o aplicativo não abre). O site público continua com wa.me.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..', 'src');
const ler = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const L = require('../src/lib/lembretes');

test('paraApp: link do Web vira link do aplicativo (mesmo número e texto)', () => {
  assert.equal(L.paraApp('https://web.whatsapp.com/send?phone=5521988771122&text=Ol%C3%A1'), 'whatsapp://send?phone=5521988771122&text=Ol%C3%A1');
  assert.equal(L.paraApp(null), null);
});

test('Pendentes e Convidar abrem pela tela intermediária no modo aplicativo, na mesma aba', () => {
  const admin = ler('routes/admin.js');
  const pend = admin.slice(admin.indexOf("router.post('/pendentes/:id/whatsapp'"), admin.indexOf("router.post('/pendentes/:id/lembrar'"));
  assert.match(pend, /linkApp: paraApp\(link\)/);
  const i = admin.indexOf("router.post('/alunos/:id/prospeccao'");
  const pros = admin.slice(i, i + 2200);
  assert.doesNotMatch(pros, /res\.redirect\(link\)/);
  assert.match(pros, /render\('admin\/contato-whatsapp'[\s\S]*linkApp: paraApp\(link\)/);
  const formsSemAba = (f, acao) => { const v = ler(f); const j = v.indexOf(acao); return v.slice(j, j + 200); };
  assert.doesNotMatch(formsSemAba('views/admin/pendentes.ejs', '/whatsapp"'), /target="_blank"/);
  assert.doesNotMatch(formsSemAba('views/admin/alunos.ejs', '/prospeccao"'), /target="_blank"/);
});

test('nenhum WhatsApp Web nem wa.me nas telas do painel (só a reserva da tela intermediária)', () => {
  const sujos = [];
  (function andar(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) andar(p);
      else if (f.endsWith('.ejs') && f !== 'contato-whatsapp.ejs' && /(web\.whatsapp\.com|wa\.me\/)/.test(fs.readFileSync(p, 'utf8').replace(/<%#[\s\S]*?%>/g, '').replace(/\/\/.*$/gm, ''))) sujos.push(path.relative(R, p));
    }
  })(path.join(R, 'views', 'admin'));
  assert.deepEqual(sujos, []);
  assert.match(ler('views/admin/matricula-rapida.ejs'), /href="whatsapp:\/\/send\?phone=55<%= p\.telefone %>"/);
  assert.match(ler('views/admin/horarios.ejs'), /const zap = \(tel\) => 'whatsapp:\/\/send\?phone=55' \+ tel;/);
  assert.match(ler('lib/planilha-excel.js'), /HYPERLINK\("whatsapp:\/\/send\?phone=55"/);
});

test('o site público continua com wa.me (abre o app no celular e pergunta no computador)', () => {
  assert.match(ler('views/partials/site-footer.ejs'), /https:\/\/wa\.me\//);
});
