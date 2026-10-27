// Teste HTTP da vitrine e da página do curso da Escola Digital. Sobe o servidor de verdade
// e só roda contra banco local (localhost / 127.0.0.1):
// DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { carregarCurso, ehBancoLocal, resolverPasta } = require('../../../src/lib/escola-digital/conteudo');
const { slugCurso } = require('../../../src/lib/vitrine');
const { iniciarServidor } = require('../ajuda/servidor');

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

const AVISO = 'Curso teórico: ensina a reconhecer e decidir. Não inclui treino prático em manequim.';

let prisma;
let ligado;
let desligado;
let slug;

before(async () => {
  if (!local) return;
  prisma = require('../../../src/db');
  await carregarCurso(resolverPasta('primeiros-socorros'), prisma);
  const curso = await prisma.curso.findFirst({ where: { modalidade: 'ONLINE', ativo: true, nome: { contains: 'Primeiros Socorros' } } });
  slug = slugCurso(curso.nome);
  ligado = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1' } });
  desligado = await iniciarServidor({});
});

after(async () => {
  if (ligado) await ligado.parar();
  if (desligado) await desligado.parar();
  if (prisma) await prisma.$disconnect();
});

test('vitrine lista o curso online', { skip }, async () => {
  const r = await fetch(ligado.url + '/digital');
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('Primeiros Socorros'));
  assert.ok(html.includes('Escola Digital CVB-RJ'));
  assert.ok(html.includes(`/digital/cursos/${slug}`));
});

test('página do curso mostra preço, parcelas, prazos e o aviso da prática', { skip }, async () => {
  const r = await fetch(`${ligado.url}/digital/cursos/${slug}`);
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('79,90'));
  assert.ok(html.includes('R$ 79,90 à vista'));
  assert.ok(html.includes('ou até 3× de R$ 29,97 no cartão'));
  assert.ok(html.includes('1 ano de acesso'));
  assert.ok(html.includes('24 meses'));
  assert.ok(html.includes(AVISO));
  assert.ok(html.includes(`/digital/cursos/${slug}/matricula`));
});

test('curso inexistente dá 404 no layout da Escola Digital', { skip }, async () => {
  const r = await fetch(ligado.url + '/digital/cursos/nao-existe');
  assert.strictEqual(r.status, 404);
  assert.ok((await r.text()).includes('Escola Digital'));
});

test('com a chave desligada /digital dá 404', { skip }, async () => {
  const r = await fetch(desligado.url + '/digital');
  assert.strictEqual(r.status, 404);
  const r2 = await fetch(`${desligado.url}/digital/cursos/${slug}`);
  assert.strictEqual(r2.status, 404);
});

test('"Entrar" segue para o login e recusa destino fora da Escola Digital', { skip }, async () => {
  const r = await fetch(`${ligado.url}/digital/entrar?voltar=${encodeURIComponent('/digital/cursos/' + slug)}`, { redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/login');
  const r2 = await fetch(`${ligado.url}/digital/entrar?voltar=${encodeURIComponent('//evil.com')}`, { redirect: 'manual' });
  assert.strictEqual(r2.status, 302);
  assert.strictEqual(r2.headers.get('location'), '/login');
  assert.ok(!(r2.headers.get('set-cookie') || '').includes('escola.sid'));
});
