// 2026-11-13: assistente da secretaria — uso e limites (20 a cada 10 min, 200 por dia), sem guardar o texto.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('uso do assistente', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const uso = require('../src/lib/assistente-uso');
  let u;
  before(async () => { u = await prisma.usuario.create({ data: { nome: 'Secretaria Assistente', email: `assist-${Date.now()}@teste.local`, papel: 'SECRETARIA' } }); });
  after(async () => { await prisma.usuario.deleteMany({ where: { id: u.id } }); await prisma.$disconnect(); });

  test('limites fixos', () => {
    assert.equal(uso.LIMITE_10MIN, 20);
    assert.equal(uso.LIMITE_DIA, 200);
  });

  test('registra tokens e nomes das ferramentas, sem texto', async () => {
    await uso.registrarUso(u.id, { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900 }, ['buscar_alunos', 'ver_aluno']);
    const r = await prisma.usoAssistente.findFirst({ where: { usuarioId: u.id } });
    assert.equal(r.tokensEntrada, 1200);
    assert.equal(r.tokensSaida, 300);
    assert.equal(r.tokensCache, 900);
    assert.deepEqual(r.ferramentas, ['buscar_alunos', 'ver_aluno']);
    assert.deepEqual(Object.keys(r).sort(), ['criadoEm', 'ferramentas', 'id', 'tokensCache', 'tokensEntrada', 'tokensSaida', 'usuarioId']);
  });

  test('20 nos últimos 10 minutos bloqueia; depois de 10 minutos libera', async () => {
    await prisma.usoAssistente.deleteMany({ where: { usuarioId: u.id } });
    assert.deepEqual(await uso.podeEnviar(u.id), { ok: true });
    const agora = new Date();
    await prisma.usoAssistente.createMany({ data: Array.from({ length: 20 }, () => ({ usuarioId: u.id, criadoEm: new Date(agora.getTime() - 60000) })) });
    const r = await uso.podeEnviar(u.id, agora);
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'Você usou muito o assistente agora; tente de novo em alguns minutos.');
    assert.deepEqual(await uso.podeEnviar(u.id, new Date(agora.getTime() + 11 * 60000)), { ok: true });
  });

  test('200 no dia bloqueia', async () => {
    await prisma.usoAssistente.deleteMany({ where: { usuarioId: u.id } });
    const agora = new Date();
    await prisma.usoAssistente.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ usuarioId: u.id, criadoEm: new Date(agora.getTime() - (11 + i) * 60000) })) });
    const r = await uso.podeEnviar(u.id, agora);
    assert.equal(r.ok, false);
    assert.match(r.erro, /hoje/);
  });

  test('excluir o usuário apaga o uso', async () => {
    const v = await prisma.usuario.create({ data: { nome: 'Temp', email: `assist-tmp-${Date.now()}@teste.local`, papel: 'SECRETARIA' } });
    await uso.registrarUso(v.id, null, []);
    await prisma.usuario.delete({ where: { id: v.id } });
    assert.equal(await prisma.usoAssistente.count({ where: { usuarioId: v.id } }), 0);
  });
});
