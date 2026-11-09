// Imagens com IA (2026-11-09), Task 4: painel do EAD (botão, gerar outra, selo, descrição, contagem). Postgres LOCAL;
// Claude e OpenAI falsos.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');
const { clienteFalso, pedidosImagensBons, openaiFalso } = require('./helpers/ia-falso');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('painel: imagens com IA', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const img = require('../src/lib/ead-imagens');
  const IA = require('../src/lib/ead-ia');
  const { uploadsDir } = require('../src/lib/upload');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-img-${s}`;
  const amb = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
  let srv; let co; let c; let m1; let m2; let tetoAntes; let contadoresAntes; let custoAntes; const cos = [];
  let chamadasClaude = 0;

  const get = async (u) => (await fetch(srv.url + u)).text();
  const post = (u, dados = {}) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', ...dados }) });
  const flash = (r) => decodeURIComponent(r.headers.get('location') || '').replace(/\+/g, ' ');
  const arquivos = () => fs.readdirSync(uploadsDir).filter((f) => f.startsWith('curso-')).length;

  before(async () => {
    process.env.OPENAI_API_KEY = 'sk-teste'; process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-teste';
    tetoAntes = await prisma.configuracao.findUnique({ where: { chave: 'ead-ia:teto-mensal-usd' } });
    contadoresAntes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'ead-ia:imagens:' } } });
    custoAntes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'ead-ia:custo-avulso:' } } });
    c = await prisma.curso.create({ data: { nome: `Curso Painel Img ${s}`, descricao: 'Kit', cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: c.id, somenteOnline: true } });
    cos.push(co.id);
    m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Montar', ordem: 0 } });
    m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Usar', ordem: 1 } });
    img.definirCliente(clienteFalso([(params) => { chamadasClaude++; return pedidosImagensBons([...params.messages[0].content.at(-1).text.matchAll(/moduloId: ([0-9a-f-]{36})/g)].map((x) => x[1])); }]));
    img.definirFetch(openaiFalso());
    srv = await ouvir(montarPainel(quem));
  });
  after(async () => {
    srv.server.close();
    img.definirCliente(null); img.definirFetch(null);
    for (const [k, v] of Object.entries({ OPENAI_API_KEY: amb.openai, ANTHROPIC_API_KEY: amb.anthropic })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    const urls = [(await prisma.curso.findUnique({ where: { id: c.id } })).imagemUrl, ...(await prisma.moduloEad.findMany({ where: { cursoOnlineId: co.id } })).map((m) => m.fotoIntroUrl)].filter(Boolean);
    for (const u of urls) fs.rmSync(path.join(uploadsDir, path.basename(u)), { force: true });
    await prisma.configuracao.deleteMany({ where: { chave: 'ead-ia:teto-mensal-usd' } });
    if (tetoAntes) await prisma.configuracao.create({ data: tetoAntes });
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'ead-ia:imagens:' } } });
    for (const x of contadoresAntes) await prisma.configuracao.create({ data: x });
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'ead-ia:custo-avulso:' } } });
    for (const x of custoAntes) await prisma.configuracao.create({ data: x });
    await prisma.logAuditoria.deleteMany({ where: { atorId: quem } });
    await apagarCursosOnline(prisma, cos);
  });

  test('[revisão I4] o botão responde na hora (segundo plano) e a página mostra "Gerando…" e depois o resultado', async () => {
    let soltar; const segura = new Promise((r) => { soltar = r; });
    const base = openaiFalso();
    img.definirFetch(async (...a) => { await segura; return base(...a); });
    const antes = arquivos();
    const t0 = Date.now();
    const r = await post(`/ead/curso/${co.id}/imagens-ia`);
    assert.equal(r.status, 302);
    assert.ok(Date.now() - t0 < 2000, 'não espera as imagens');
    assert.match(flash(r), /em segundo plano/);
    assert.match(await get(`/ead/curso/${co.id}`), /Gerando as imagens…/);
    // duplo clique enquanto gera: não começa outra
    assert.match(flash(await post(`/ead/curso/${co.id}/imagens-ia`)), /já estão sendo geradas/);
    soltar();
    await img.ocioso();
    img.definirFetch(base);
    assert.match(await get(`/ead/curso/${co.id}`), /3 imagens geradas\./);
    assert.equal(arquivos(), antes + 3, 'capa + 2 módulos, sem arquivo a mais');
  });

  test('segundo clique: nada para preencher (não chama o Claude)', async () => {
    const n = chamadasClaude;
    await post(`/ead/curso/${co.id}/imagens-ia`);
    await img.ocioso();
    assert.match(await get(`/ead/curso/${co.id}`), /Nada para preencher: a capa e os módulos já têm imagem\./);
    assert.equal(chamadasClaude, n);
  });

  test('páginas mostram selo, descrição e "Gerar outra"; gerar outra troca a imagem do módulo', async () => {
    const pc = await get(`/ead/curso/${co.id}`);
    assert.match(pc, /Imagem gerada por IA/);
    assert.match(pc, /Kit de primeiros socorros sobre a bancada/);
    assert.match(pc, /capa\/gerar-outra/);
    const pm = await get(`/ead/modulo/${m1.id}/editar`);
    assert.match(pm, /Imagem gerada por IA/);
    assert.match(pm, /Imagem do módulo 1|Imagem do módulo 2/);
    const antes = (await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoIntroUrl;
    assert.match(flash(await post(`/ead/modulo/${m1.id}/foto/gerar-outra`)), /em segundo plano/);
    await img.ocioso();
    assert.match(await get(`/ead/modulo/${m1.id}/editar`), /Imagem nova gerada\./);
    assert.notEqual((await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoIntroUrl, antes);
  });

  test('enviar imagem própria no módulo desliga o selo', async () => {
    const png = require('./helpers/ia-falso').PNG_1X1;
    const fd = new FormData();
    fd.append('_csrf', 'x'); fd.append('titulo', 'Montar'); fd.append('minutosEstimados', '10');
    fd.append('foto', new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }), 'minha.png');
    const r = await fetch(`${srv.url}/ead/modulo/${m1.id}/editar`, { method: 'POST', redirect: 'manual', body: fd });
    assert.equal(r.status, 302, await r.text().catch(() => ''));
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoGeradaPorIa, false);
  });

  test('teto do Claude estourado: não chama o Claude', async () => {
    await prisma.moduloEad.update({ where: { id: m2.id }, data: { fotoIntroUrl: null } });
    await IA.definirTeto('0', quem);
    const n = chamadasClaude;
    const r = await post(`/ead/curso/${co.id}/imagens-ia`);
    await img.ocioso();
    assert.match(flash(r), /teto/i);
    assert.equal(chamadasClaude, n);
    await IA.definirTeto('50', quem);
  });

  test('a lista da IA mostra a contagem de imagens', async () => {
    const { mes, total } = await img.contagem();
    assert.match(await get('/ead/ia'), new RegExp(`Imagens geradas com IA:(</b>)? ${mes} neste mês · ${total} no total`));
  });

  test('[pedido] páginas têm o campo "Pedido da imagem" preenchido; gerar com o pedido editado usa o texto (sem chamar o Claude)', async () => {
    const pm = await get(`/ead/modulo/${m1.id}/editar`);
    assert.match(pm, /<textarea[^>]*name="pedido"/);
    assert.match(await get(`/ead/curso/${co.id}`), /<textarea[^>]*name="pedido"[^>]*>Realistic photo, Brazilian|<textarea[^>]*name="pedido"[^>]*>[^<]*first aid kit/);
    const n = chamadasClaude;
    const f = openaiFalso();
    img.definirFetch(f);
    const r = await post(`/ead/modulo/${m1.id}/foto/gerar-outra`, { pedido: 'Escrito por mim: bebê dormindo no berço, luz suave' });
    assert.equal(r.status, 302);
    await img.ocioso();
    assert.ok(f.chamadas[0].body.prompt.startsWith('Escrito por mim: bebê dormindo no berço, luz suave'));
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoPedido, 'Escrito por mim: bebê dormindo no berço, luz suave');
    assert.equal(chamadasClaude, n, 'pedido escrito pela pessoa não passa pelo Claude');
  });
});
