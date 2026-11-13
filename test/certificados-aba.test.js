// 2026-11-12: aba "Certificados" no painel — quem assina (nome, cargo, assinatura escaneada), com/sem assinatura no
// certificado online, livro em uso e a prévia. "Modelos" fica só com a mensagem de boas-vindas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const V = (p) => path.join(__dirname, '..', 'src', 'views', 'admin', p);
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ajustes = {
  assinantes: [{ nome: 'ALESSANDRA RACHEL GOMES DA SILVA', cargo: 'Coordenadora da Escola', imagemUrl: '/uploads/a.webp' }, { nome: 'LUIZ CARLOS DOS SANTOS', cargo: 'Presidente', imagemUrl: null }],
  livro: 2, assinaturaOnline: 'com',
};
const render = (x = {}) => ejs.renderFile(V('certificados.ejs'), {
  ajustes, ok: null, erro: null, csrfToken: 'x', asset: (u) => u, pode: () => true, admPapel: 'DEV', usuario: { nome: 'Dev', papel: 'DEV' }, modo: 'presencial', ...x,
});

test('aba Certificados: cartões de quem assina com miniatura, envio e remover', async () => {
  const html = await render();
  assert.match(html, /<form method="POST" action="\/certificados\?_csrf=x"[^>]*enctype="multipart\/form-data"/);
  assert.match(html, /value="ALESSANDRA RACHEL GOMES DA SILVA"/);
  assert.match(html, /<img src="\/uploads\/a\.webp" alt="Assinatura de ALESSANDRA RACHEL GOMES DA SILVA"/);
  assert.match(html, /name="assinantes\[0\]\[removerImg\]"/);
  assert.equal((html.match(/type="file" name="assinaturaImg\d"/g) || []).length, 6);
  assert.match(html, /name="assinaturaOnline" value="com" checked/);
  assert.match(html, /name="livro" min="1" value="2"/);
  assert.match(html, /<iframe[^>]+src="\/certificados\/previa"/);
});

test('rotas: GET/POST /certificados e a prévia; Modelos não salva mais o certificado', () => {
  const a = ler('src/routes/admin.js');
  assert.match(a, /router\.get\('\/certificados', requirePermissao\('turmas:gerenciar'\)/);
  assert.match(a, /router\.post\('\/certificados', requirePermissao\('turmas:gerenciar'\), receberAssinaturas/);
  assert.match(a, /router\.get\('\/certificados\/previa', requirePermissao\('turmas:gerenciar'\)/);
  const post = a.slice(a.indexOf("router.post('/modelos'"), a.indexOf("router.post('/modelos'") + 600);
  assert.doesNotMatch(post, /certificado\.salvarAjustes/);
  assert.doesNotMatch(ler('src/views/admin/modelos.ejs'), /assinantes\[/);
});

test('menu do painel tem "Certificados" nos dois modos', () => {
  // 2026-11-13: o menu saiu do header.ejs para lib/menu-painel.js.
  const { montarMenu } = require('../src/lib/menu-painel');
  for (const modo of ['presencial', 'online']) {
    const m = montarMenu({ modo, papel: 'DEV', pode: () => true, ativo: '' });
    assert.ok(m.some((g) => g.href === '/certificados'), modo);
  }
});

test('exemplo da prévia: aluno de exemplo com as assinaturas atuais', () => {
  const { exemploCertificadoEad } = require('../src/lib/ead-certificado');
  const d = exemploCertificadoEad(ajustes);
  assert.equal(d.nome, 'Aluno Exemplo');
  assert.equal(d.teste, true);
  assert.deepEqual(d.assinaturas.map((x) => x.nome), ['ALESSANDRA RACHEL GOMES DA SILVA', 'LUIZ CARLOS DOS SANTOS']);
  assert.equal(d.assinaturas[0].imagemUrl, '/uploads/a.webp');
});
