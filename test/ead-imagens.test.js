// Imagens com IA (2026-11-09), Task 1: o Claude escreve os pedidos; a OpenAI gera. Sem banco, serviços falsos.
// Spec: docs/superpowers/specs/2026-11-09-ead-ia-fotos.md §2-3.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const img = require('../src/lib/ead-imagens');
const E = require('../src/lib/ead-ia-esquema');
const { clienteFalso, pedidosImagensBons, openaiFalso, PNG_1X1 } = require('./helpers/ia-falso');

const antes = { k: process.env.OPENAI_API_KEY, m: process.env.OPENAI_IMAGE_MODEL };
afterEach(() => {
  if (antes.k === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = antes.k;
  if (antes.m === undefined) delete process.env.OPENAI_IMAGE_MODEL; else process.env.OPENAI_IMAGE_MODEL = antes.m;
});

test('gerarNaOpenAI: body, header e b64 → Buffer; modelo da variável', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  delete process.env.OPENAI_IMAGE_MODEL;
  const f = openaiFalso();
  const buf = await img.gerarNaOpenAI('a kit on a table', { fetch: f });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
  const c = f.chamadas[0];
  assert.equal(c.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(c.opts.headers.Authorization, 'Bearer sk-teste');
  assert.deepEqual(c.body, { model: 'gpt-image-1', prompt: 'a kit on a table', size: '1536x1024', quality: 'medium', n: 1 });
  process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
  await img.gerarNaOpenAI('x', { fetch: f });
  assert.equal(f.chamadas[1].body.model, 'gpt-image-2');
});

test('gerarNaOpenAI: resposta com url baixa a imagem; sem imagem é erro', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  const bytes = Buffer.from(PNG_1X1, 'base64');
  const f = openaiFalso([() => ({ status: 200, json: { data: [{ url: 'https://img.exemplo/x.png' }] } }), () => ({ bytes })]);
  const buf = await img.gerarNaOpenAI('x', { fetch: f });
  assert.equal(f.chamadas[1].url, 'https://img.exemplo/x.png');
  assert.equal(buf.length, bytes.length);
  await assert.rejects(img.gerarNaOpenAI('x', { fetch: openaiFalso([() => ({ status: 200, json: { data: [] } })]) }), img.ErroImagem);
});

test('gerarNaOpenAI: demora além do limite → falha (não prende a fila)', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  await assert.rejects(img.gerarNaOpenAI('x', { fetch: openaiFalso([() => 'nunca']), timeoutMs: 50 }), img.ErroImagem);
});

test('gerarComReserva: recusa → tenta o pedido curto; as duas falham → null', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  const recusa = () => ({ status: 400, json: { error: { code: 'moderation_blocked', message: 'blocked' } } });
  const f = openaiFalso([recusa, () => ({ status: 200, json: { data: [{ b64_json: PNG_1X1 }] } })]);
  const buf = await img.gerarComReserva({ pedido: 'longo', pedidoCurto: 'curto' }, { fetch: f });
  assert.ok(buf);
  assert.deepEqual(f.chamadas.map((c) => c.body.prompt), ['longo', 'curto']);
  assert.equal(await img.gerarComReserva({ pedido: 'a', pedidoCurto: 'b' }, { fetch: openaiFalso([recusa]) }), null);
});

test('validarPedidosImagens: corta nos limites, descarta módulo desconhecido, exige capa', () => {
  const j = pedidosImagensBons(['m1', 'm2']);
  j.capa.pedido = 'x'.repeat(700); j.capa.descricao = 'y'.repeat(300); j.capa.pedidoCurto = 'z'.repeat(300);
  j.modulos.push({ moduloId: 'estranho', pedido: 'p', pedidoCurto: 'p', descricao: 'd' });
  const r = E.validarPedidosImagens(j, ['m1', 'm2']);
  assert.equal(r.ok, true);
  assert.equal(r.pedidos.capa.pedido.length, 600);
  assert.equal(r.pedidos.capa.descricao.length, 200);
  assert.equal(r.pedidos.capa.pedidoCurto.length, 200);
  assert.deepEqual(r.pedidos.modulos.map((m) => m.moduloId), ['m1', 'm2']);
  assert.equal(E.validarPedidosImagens({ modulos: [] }, []).ok, false);
});

test('pedirAoClaude: esforço baixo e regras (sem texto escrito, identidade da Cruz Vermelha) no system', async () => {
  const cli = clienteFalso([() => pedidosImagensBons(['m1'])]);
  const r = await img.pedirAoClaude({ curso: { nome: 'Kit', descricao: 'd', categoria: null }, modulos: [{ id: 'm1', titulo: 'Montar', topicos: ['a'] }] }, { cliente: cli });
  assert.equal(r.pedidos.modulos[0].moduloId, 'm1');
  const p = cli.chamadas[0];
  assert.equal(p.output_config.effort, 'low');
  const sys = JSON.stringify(p.system);
  assert.match(sys, /Red Cross/);
  assert.match(sys, /no written text/i);
});

test('temOpenAI: depende da chave', () => {
  delete process.env.OPENAI_API_KEY;
  assert.equal(img.temOpenAI(), false);
  process.env.OPENAI_API_KEY = 'sk-x';
  assert.equal(img.temOpenAI(), true);
});

test('[modelo] "does not exist": descobre o modelo de imagem da conta (/v1/models), tenta de novo e guarda', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  delete process.env.OPENAI_IMAGE_MODEL;
  img.esquecerModelo();
  const naoExiste = () => ({ status: 400, json: { error: { message: "The model 'gpt-image-1' does not exist.", code: 'model_not_found' } } });
  const modelos = () => ({ status: 200, json: { data: [{ id: 'gpt-4o' }, { id: 'dall-e-3' }, { id: 'gpt-image-1.5' }, { id: 'gpt-image-1-mini' }] } });
  const ok = () => ({ status: 200, json: { data: [{ b64_json: PNG_1X1 }] } });
  const f = openaiFalso([naoExiste, modelos, ok, ok]);
  assert.ok(await img.gerarNaOpenAI('x', { fetch: f }));
  assert.equal(f.chamadas[1].url, 'https://api.openai.com/v1/models');
  assert.equal(f.chamadas[2].body.model, 'gpt-image-1.5', 'o gpt-image mais novo (não o mini)');
  await img.gerarNaOpenAI('y', { fetch: f });
  assert.equal(f.chamadas[3].body.model, 'gpt-image-1.5', 'guardou: não consulta de novo');
  assert.equal(f.chamadas.length, 4);
  img.esquecerModelo();
});

test('[modelo] só dall-e-3 na conta: usa com o tamanho e a qualidade dele', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  img.esquecerModelo();
  const naoExiste = () => ({ status: 404, json: { error: { message: "The model 'gpt-image-1' does not exist.", code: 'model_not_found' } } });
  const f = openaiFalso([naoExiste, () => ({ status: 200, json: { data: [{ id: 'dall-e-3' }, { id: 'whisper-1' }] } }), () => ({ status: 200, json: { data: [{ b64_json: PNG_1X1 }] } })]);
  assert.ok(await img.gerarNaOpenAI('x', { fetch: f }));
  assert.deepEqual(f.chamadas[2].body, { model: 'dall-e-3', prompt: 'x', size: '1792x1024', quality: 'standard', n: 1, response_format: 'b64_json' });
  img.esquecerModelo();
});

test('[modelo] nenhum modelo de imagem na conta: erro explicando', async () => {
  process.env.OPENAI_API_KEY = 'sk-teste';
  img.esquecerModelo();
  const naoExiste = () => ({ status: 400, json: { error: { message: "The model 'gpt-image-1' does not exist." } } });
  const f = openaiFalso([naoExiste, () => ({ status: 200, json: { data: [{ id: 'gpt-4o' }] } })]);
  await assert.rejects(img.gerarNaOpenAI('x', { fetch: f }), /nenhum modelo de imagem/i);
  img.esquecerModelo();
});

test('[identidade] as regras seguem a identidade da Cruz Vermelha (cruz vermelha liberada, sem texto nem outras marcas)', () => {
  for (const t of [img.SYSTEM_PEDIDOS, img.REGRAS_IMAGEM]) {
    assert.match(t, /Cruz Vermelha Brasileira/);
    assert.match(t, /red cross on white (is allowed|may appear)/i);
    assert.doesNotMatch(t, /never the Red Cross emblem|green or white cross/i);
    assert.match(t, /no (written )?text/i);
  }
});
