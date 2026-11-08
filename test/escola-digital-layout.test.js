// Escola Digital (2026-11), Task 7: topo e rodapé das páginas do curso online iguais ao site (vistoria H1–H11),
// campo do cupom (B1) e topo no celular (B2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const V = path.join(__dirname, '..', 'src', 'views');
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const locais = (extra = {}) => ({ asset: (u) => u, titulo: 'Curso', base: '/escola-digital/curso', eadModo: 'pago', ...extra });
const topo = (extra) => ejs.renderFile(path.join(V, 'ead-teste', '_topo.ejs'), locais(extra));
const fim = (extra) => ejs.renderFile(path.join(V, 'ead-teste', '_fim.ejs'), locais(extra));

test('topo: marca "ESCOLA DIGITAL" e o logo vai para /escola-digital (ligada) ou / (desligada)', async () => {
  const lig = await topo({ escolaDigital: true });
  assert.match(lig, /ESCOLA DIGITAL/);
  assert.match(lig, /class="ea-logo" href="\/escola-digital"/);
  assert.match(await topo({ escolaDigital: false }), /class="ea-logo" href="\/"/);
});

test('topo: logado tem "Minha conta", "Cursos online" e "Sair"; deslogado tem "Entrar"; gestor vê "Minha escola"', async () => {
  const logado = await topo({ usuario: { id: 'u', nome: 'Ana Paula', papel: 'ALUNO' }, contaLinks: { gestor: true } });
  assert.match(logado, /Olá, Ana/);
  assert.match(logado, /href="\/minha-conta"/); assert.match(logado, /href="\/minha-conta\?sec=online"/);
  assert.match(logado, /href="\/minha-escola"/); assert.match(logado, /action="\/logout"|href="\/logout"/);
  const sem = await topo({ usuario: null });
  assert.match(sem, /href="\/login"[^>]*>Entrar/);
  assert.doesNotMatch(sem, /Minha escola/);
});

test('topo: a faixa de cima leva ao site da Cruz Vermelha RJ e tem "Site da escola"', async () => {
  const t = await topo({});
  assert.match(t, /class="ea-topbar"[\s\S]*href="https:\/\/cruzvermelhariodejaneiro\.org\/"/);
  assert.match(t, /Site da escola/);
});

test('rodapé: privacidade, preferências de cookies, WhatsApp e copyright', async () => {
  const f = await fim({ medir: true });
  assert.match(f, /href="\/privacidade"/);
  assert.match(f, /data-cvrj-cookies/);
  assert.doesNotMatch(await fim({}), /data-cvrj-cookies/, 'sem o aviso de cookies na página, o link não aparece');
  assert.match(f, /wa\.me\//);
  assert.match(f, /©|&copy;/);
});

test('rodapé do site sem "presencial" na frase (o pagamento online usa o layout do site)', () => {
  assert.match(ler('src/views/partials/site-footer.ejs'), /Capacitação para quem quer cuidar, prevenir e agir com responsabilidade\./);
});

test('menu de conta do site tem "Cursos online" e "Minha escola" para quem tem', () => {
  const h = ler('src/views/partials/site-header.ejs');
  assert.match(h, /sec=online/);
  assert.match(h, /\/minha-escola/);
});

test('cupom: o botão "Aplicar" não estica (o campo fica com a largura)', () => {
  assert.match(ler('src/public/ead.css'), /\.ea-cupom-linha \.ea-pilula\s*\{[^}]*width:\s*auto[^}]*flex:\s*none/);
  assert.match(ler('src/public/ead.css'), /@media \(max-width: 819px\) \{ \.ea-heroi-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'só no celular: no computador são duas colunas');
});

test('pagamento em andamento com cupom mostra o preço riscado', () => {
  const capa = ler('src/views/ead-teste/capa.ejs');
  const pendente = capa.slice(capa.indexOf("compra.situacao === 'pendente'"), capa.indexOf("compra.situacao === 'cancelado'"));
  assert.match(pendente, /compra\.cupom\.precoCheio/);
});

test('certificado: na tela pequena reduz para caber; 297 mm só na impressão', () => {
  assert.match(ler('src/public/certificado.css'), /@media screen and \(max-width:\s*1100px\)/);
});

test('módulo concluído pelo pré-teste diz isso na lista', () => {
  assert.match(ler('src/views/ead-teste/modulo.ejs'), /concluído pelo pré-teste/);
});

test('lote: botão "Copiar" no convite e confirmação em "Desligar" e "Trocar o link"', () => {
  const l = ler('src/views/escola/lote.ejs');
  assert.match(l, /data-copiar/);
  assert.match(l, /convite\/desligar"[^>]*data-confirmar=|data-confirmar="[^"]*"[^>]*convite\/desligar/);
});
