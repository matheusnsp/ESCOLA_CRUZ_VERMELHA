// Imagens com IA (2026-11-09), Task 2: gravar, gerar outra, contadores. Postgres LOCAL; Claude e OpenAI falsos;
// imagens guardadas em uploads/ local (sem Supabase).
require('dotenv').config();
const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { clienteFalso, pedidosImagensBons, openaiFalso } = require('./helpers/ia-falso');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('imagens com IA: banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const img = require('../src/lib/ead-imagens');
  const IA = require('../src/lib/ead-ia');
  const { uploadsDir } = require('../src/lib/upload');
  const s = String(Date.now()).slice(-7);
  const chaveAntes = process.env.OPENAI_API_KEY;
  const existe = (url) => fs.existsSync(path.join(uploadsDir, path.basename(url)));
  const cursos = []; const cos = [];
  let contadoresAntes; let custoAntes;

  async function cursoOnline({ comFotoNoSegundo = true } = {}) {
    const c = await prisma.curso.create({ data: { nome: `Curso Imagens ${s} ${cursos.length}`, descricao: 'Kit de primeiros socorros', cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    const co = await prisma.cursoOnline.create({ data: { cursoId: c.id, somenteOnline: true } });
    const m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Montar o kit', ordem: 0 } });
    const m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Usar o kit', ordem: 1, fotoIntroUrl: comFotoNoSegundo ? '/uploads/ja-tinha.webp' : null } });
    cursos.push(c.id); cos.push(co.id);
    return { c, co, m1, m2 };
  }
  const claude = (ids) => clienteFalso([() => pedidosImagensBons(ids)]);

  before(async () => {
    contadoresAntes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'ead-ia:imagens:' } } });
    custoAntes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'ead-ia:custo-avulso:' } } });
  });
  afterEach(() => { if (chaveAntes === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = chaveAntes; });
  after(async () => {
    const urls = [
      ...(await prisma.curso.findMany({ where: { id: { in: cursos } }, select: { imagemUrl: true } })).map((x) => x.imagemUrl),
      ...(await prisma.moduloEad.findMany({ where: { cursoOnlineId: { in: cos } }, select: { fotoIntroUrl: true } })).map((x) => x.fotoIntroUrl),
    ].filter((u) => u && u.startsWith('/uploads/curso-'));
    for (const u of urls) fs.rmSync(path.join(uploadsDir, path.basename(u)), { force: true });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: { in: cos } } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: cos } } });
    await prisma.curso.deleteMany({ where: { id: { in: cursos } } });
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'ead-ia:imagens:' } } });
    for (const c of contadoresAntes) await prisma.configuracao.create({ data: c });
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'ead-ia:custo-avulso:' } } });
    for (const c of custoAntes) await prisma.configuracao.create({ data: c });
  });

  test('curso online: só a capa e o módulo vazio ganham imagem (WebP), pedido, descrição e selo; contadores +2', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const { c, co, m1, m2 } = await cursoOnline();
    const antes = await img.contagem();
    const custos = [];
    const r = await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: openaiFalso(), custo: (u) => custos.push(u) });
    assert.equal(r.geradas, 2);
    assert.equal(r.aviso, null);
    assert.equal(custos.length, 1, 'o uso do Claude foi informado');
    const cc = await prisma.curso.findUnique({ where: { id: c.id } });
    assert.match(cc.imagemUrl, /^\/uploads\/curso-.*\.webp$/);
    assert.ok(existe(cc.imagemUrl));
    assert.equal(cc.imagemGeradaPorIa, true);
    assert.match(cc.imagemSugestao, /Kit de primeiros socorros/);
    assert.match(cc.imagemPedido, /first aid kit/);
    const d1 = await prisma.moduloEad.findUnique({ where: { id: m1.id } });
    assert.match(d1.fotoIntroUrl, /\.webp$/);
    assert.equal(d1.fotoGeradaPorIa, true);
    assert.equal(d1.fotoSugestao, 'Imagem do módulo 1');
    const d2 = await prisma.moduloEad.findUnique({ where: { id: m2.id } });
    assert.equal(d2.fotoIntroUrl, '/uploads/ja-tinha.webp', 'a imagem posta pela secretaria fica');
    assert.equal(d2.fotoGeradaPorIa, false);
    const depois = await img.contagem();
    assert.equal(depois.mes, antes.mes + 2);
    assert.equal(depois.total, antes.total + 2);
  });

  test('sem chave da OpenAI: grava só descrições e pedidos, não chama a OpenAI, avisa', async () => {
    delete process.env.OPENAI_API_KEY;
    const { c, co, m1, m2 } = await cursoOnline({ comFotoNoSegundo: false });
    const f = openaiFalso();
    const r = await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: f, custo: () => {} });
    assert.equal(f.chamadas.length, 0);
    assert.equal(r.geradas, 0);
    assert.equal(r.descricoes, 3);
    assert.equal(r.aviso, 'Sem chave da OpenAI: as descrições do Claude estão em cada módulo, envie as imagens.');
    assert.equal((await prisma.curso.findUnique({ where: { id: c.id } })).imagemUrl, null);
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoSugestao, 'Imagem do módulo 1');
  });

  test('OpenAI recusa as duas tentativas num módulo: ele fica vazio, com a descrição', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const { co, m1, m2 } = await cursoOnline();
    const ok = () => ({ status: 200, json: { data: [{ b64_json: require('./helpers/ia-falso').PNG_1X1 }] } });
    const recusa = () => ({ status: 400, json: { error: { message: 'blocked' } } });
    // capa ok; módulo 1: recusa, recusa
    const r = await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: openaiFalso([ok, recusa, recusa]), custo: () => {} });
    assert.equal(r.geradas, 1);
    const d1 = await prisma.moduloEad.findUnique({ where: { id: m1.id } });
    assert.equal(d1.fotoIntroUrl, null);
    assert.equal(d1.fotoSugestao, 'Imagem do módulo 1');
  });

  test('curso presencial: imagemDoCurso troca a imagem e apaga a antiga', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const c = await prisma.curso.create({ data: { nome: `Presencial Imagem ${s}`, cargaHoraria: 8, precoAvista: 100, precoCheio: 120, valorParcela: 40, ativo: true } });
    cursos.push(c.id);
    const r1 = await img.imagemDoCurso(c.id, { cliente: claude([]), fetch: openaiFalso(), custo: () => {} });
    assert.deepEqual(r1, { ok: true });
    const a = (await prisma.curso.findUnique({ where: { id: c.id } })).imagemUrl;
    assert.ok(existe(a));
    await img.imagemDoCurso(c.id, { cliente: claude([]), fetch: openaiFalso(), custo: () => {} });
    const b = await prisma.curso.findUnique({ where: { id: c.id } });
    assert.notEqual(b.imagemUrl, a);
    assert.ok(existe(b.imagemUrl));
    assert.equal(existe(a), false, 'a antiga foi apagada');
    assert.equal(b.imagemGeradaPorIa, true);
  });

  test('gerarOutra: imagem nova com o mesmo pedido, a antiga apagada; sem pedido avisa', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const { co, m1, m2 } = await cursoOnline();
    await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: openaiFalso(), custo: () => {} });
    const antes = (await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoIntroUrl;
    const f = openaiFalso();
    assert.deepEqual(await img.gerarOutra({ tipo: 'modulo', id: m1.id }, { fetch: f }), { ok: true });
    assert.equal(f.chamadas[0].body.prompt, 'Realistic photo for module 1, no text');
    const depois = (await prisma.moduloEad.findUnique({ where: { id: m1.id } })).fotoIntroUrl;
    assert.notEqual(depois, antes);
    assert.equal(existe(antes), false);
    assert.deepEqual(await img.gerarOutra({ tipo: 'modulo', id: m2.id }, { fetch: f }), { ok: false, erro: 'Ainda não há pedido de imagem: use Gerar imagens com IA.' });
  });

  test('custo avulso do Claude soma no gasto do mês', async () => {
    const antes = await IA.gastoDoMes();
    await IA.somarCustoAvulso({ input_tokens: 100000, output_tokens: 10000 });
    assert.ok((await IA.gastoDoMes()) > antes);
  });

  test('[revisão I2] imagem gerada em módulo VALIDADO volta o módulo a rascunho (bulk e gerar outra)', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const { co, m1, m2 } = await cursoOnline({ comFotoNoSegundo: false });
    await prisma.moduloEad.updateMany({ where: { id: { in: [m1.id, m2.id] } }, data: { status: 'VALIDADO', validadoPor: 'dev', validadoEm: new Date() } });
    await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: openaiFalso(), custo: () => {} });
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: m1.id } })).status, 'RASCUNHO');
    assert.ok(await prisma.logAuditoria.count({ where: { acao: 'EAD_INVALIDOU_MODULO', alvoId: m1.id } }));
    await prisma.moduloEad.update({ where: { id: m2.id }, data: { status: 'VALIDADO' } });
    assert.deepEqual(await img.gerarOutra({ tipo: 'modulo', id: m2.id }, { fetch: openaiFalso() }), { ok: true });
    assert.equal((await prisma.moduloEad.findUnique({ where: { id: m2.id } })).status, 'RASCUNHO');
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: [m1.id, m2.id] } } });
  });

  test('[revisão I3] a trava é renovada enquanto gera (não vence no meio de uma geração longa)', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const { co, m1, m2 } = await cursoOnline({ comFotoNoSegundo: false });
    img.configurar({ renovarMs: 30, validadeMs: 80 });
    const vistos = new Set();
    const rapido = openaiFalso();
    const lento = async (...a) => {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 30));
        const t = await prisma.configuracao.findUnique({ where: { chave: `ead-ia:imagens-ocupado:curso-online:${co.id}` } });
        if (t) vistos.add(t.valor);
      }
      return rapido(...a);
    };
    try {
      const corrida = img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: lento, custo: () => {} });
      await new Promise((r) => setTimeout(r, 250)); // passou da validade (80 ms) várias vezes
      const segunda = await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: openaiFalso(), custo: () => {} });
      assert.equal(segunda.aviso, img.OCUPADO, 'a segunda não entra: a trava foi renovada ' + JSON.stringify(segunda) + ' vistos=' + vistos.size);
      await corrida;
    } finally {
      img.configurar({ renovarMs: 60000, validadeMs: 180000 });
    }
    assert.ok(vistos.size >= 2, `a trava mudou durante a geração (${vistos.size})`);
  });

  test('[motivo] a OpenAI recusa: a mensagem mostra o motivo que ela devolveu', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const c = await prisma.curso.create({ data: { nome: `Presencial Motivo ${s}`, cargaHoraria: 8, precoAvista: 100, precoCheio: 120, valorParcela: 40, ativo: true } });
    cursos.push(c.id);
    const recusa = () => ({ status: 403, json: { error: { message: 'Your organization must be verified to use the model `gpt-image-1`.', type: 'invalid_request_error' } } });
    const r = await img.imagemDoCurso(c.id, { cliente: claude([]), fetch: openaiFalso([recusa]), custo: () => {} });
    assert.equal(r.ok, false);
    assert.match(r.erro, /organization must be verified/);
    const { co, m1, m2 } = await cursoOnline({ comFotoNoSegundo: false });
    const b = await img.imagensDoCursoOnline(co.id, { cliente: claude([m1.id, m2.id]), fetch: openaiFalso([recusa]), custo: () => {} });
    assert.equal(b.geradas, 0);
    assert.match(b.motivo || '', /organization must be verified/);
  });
});
