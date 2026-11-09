// Escola Digital — vitrine (fase 1, 2026-11-09), Task 2: "Curso gratuito" e a caixa "Vitrine" no painel.
// Spec: docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md §2. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('painel: vitrine e curso gratuito', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const ed = require('../src/lib/escola-digital');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-vitp-${s}`;
  let server; let url; let destaqueAntes; const cos = [];

  const get = async (u) => (await fetch(url + u)).text();
  const post = (u, dados) => fetch(url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', ...dados }) });
  const flash = async (r) => decodeURIComponent(r.headers.get('location') || '');
  const ler = (id) => prisma.cursoOnline.findUnique({ where: { id } });
  async function cursoOnline(nome, dados = {}) {
    const c = await prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    const co = await prisma.cursoOnline.create({ data: { cursoId: c.id, somenteOnline: true, ...dados } });
    await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', status: 'VALIDADO' } });
    cos.push(co.id);
    return co;
  }

  before(async () => {
    destaqueAntes = await prisma.configuracao.findUnique({ where: { chave: ed.CHAVE_DESTAQUE } });
    ({ server, url } = await ouvir(montarPainel(quem)));
  });
  after(async () => {
    server.close();
    await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE_DESTAQUE } });
    if (destaqueAntes) await prisma.configuracao.create({ data: { chave: destaqueAntes.chave, valor: destaqueAntes.valor } });
    ed.limparCache();
    await prisma.logAuditoria.deleteMany({ where: { atorId: quem } });
    await apagarCursosOnline(prisma, cos);
  });

  test('marcar gratuito zera preço e parcelas e permite publicar; desmarcar volta a pedir preço', async () => {
    const co = await cursoOnline('Gratis Painel', { precoOnline: 40, maxParcelas: 4 });
    const r = await post(`/ead/curso/${co.id}/gratuito`, { gratuito: '1' });
    assert.equal(r.status, 302);
    let d = await ler(co.id);
    assert.equal(d.gratuito, true); assert.equal(Number(d.precoOnline), 0); assert.equal(d.maxParcelas, 1);
    const pag = await get(`/ead/curso/${co.id}`);
    assert.match(pag, /name="gratuito"[^>]*checked|checked[^>]*name="gratuito"/);
    assert.match(pag, /name="precoOnline"[^>]*disabled/);
    assert.match(pag, /name="maxParcelas"[^>]*disabled/);
    assert.doesNotMatch(pag, /Defina o preço/);
    assert.equal((await post(`/ead/curso/${co.id}/preco`, { precoOnline: '10' })).status, 302);
    assert.equal(Number((await ler(co.id)).precoOnline), 0, 'preço não muda com Gratuito marcado');
    assert.equal((await post(`/ead/curso/${co.id}/publicar`, { acao: 'ligar' })).status, 302);
    assert.equal((await ler(co.id)).publicado, true);
    const r2 = await post(`/ead/curso/${co.id}/gratuito`, { gratuito: '0' });
    assert.match(await flash(r2), /defina o preço/);
    assert.match(await flash(r2), /não aparece no site/, '[revisão] avisa que o curso publicado some até ter preço');
    d = await ler(co.id);
    assert.equal(d.gratuito, false); assert.equal(d.precoOnline, null);
    await post(`/ead/curso/${co.id}/publicar`, { acao: 'desligar' });
    await post(`/ead/curso/${co.id}/publicar`, { acao: 'ligar' });
    assert.equal((await ler(co.id)).publicado, false);
    assert.match(await get(`/ead/curso/${co.id}`), /Defina o preço do curso online \(ou marque Gratuito\)\./);
  });

  test('com cupom ativo do curso, não marca gratuito', async () => {
    const co = await cursoOnline('Gratis Cupom', { precoOnline: 40 });
    await prisma.cupomEad.create({ data: { codigo: `VITP${s}`, tipo: 'PERCENTUAL', valor: 10, cursoOnlineId: co.id, criadoPor: quem } });
    const r = await post(`/ead/curso/${co.id}/gratuito`, { gratuito: '1' });
    assert.match(await flash(r), /cupom ativo/);
    assert.equal((await ler(co.id)).gratuito, false);
  });

  test('caixa Vitrine: destaque (e automático) e ordem com subir/descer; publicar põe no fim', async () => {
    const a = await cursoOnline('Vitrine A', { precoOnline: 10, publicado: true, ordemVitrine: -500 });
    const b = await cursoOnline('Vitrine B', { precoOnline: 10, publicado: true, ordemVitrine: -499 });
    let pag = await get('/ead');
    assert.match(pag, /<select[^>]*name="cursoOnlineId"/);
    assert.match(pag, new RegExp(`value="${b.id}"`));
    await post('/ead/escola-digital/destaque', { cursoOnlineId: b.id });
    assert.equal(await ed.lerDestaque(), b.id);
    pag = await get('/ead');
    assert.match(pag, new RegExp(`value="${b.id}" selected`));
    await post('/ead/escola-digital/destaque', { cursoOnlineId: '' });
    assert.equal(await ed.lerDestaque(), null);

    const ordem = async () => (await prisma.cursoOnline.findMany({ where: { publicado: true }, orderBy: [{ ordemVitrine: 'asc' }, { curso: { nome: 'asc' } }], select: { id: true } })).map((c) => c.id);
    assert.ok((await ordem()).indexOf(a.id) < (await ordem()).indexOf(b.id));
    assert.equal((await post(`/ead/escola-digital/ordem/${b.id}/subir`, {})).status, 302);
    let o = await ordem();
    assert.equal(o.indexOf(b.id) + 1, o.indexOf(a.id), 'B subiu e ficou logo antes de A');
    await post(`/ead/escola-digital/ordem/${b.id}/descer`, {});
    o = await ordem();
    assert.equal(o.indexOf(a.id) + 1, o.indexOf(b.id), 'B desceu de volta');

    const c = await cursoOnline('Vitrine C', { precoOnline: 10 });
    await post(`/ead/curso/${c.id}/publicar`, { acao: 'ligar' });
    o = await ordem();
    assert.equal(o[o.length - 1], c.id, 'publicado agora entra no fim');
  });
});
