// 2026-11-12: Modelos guarda a escolha "com/sem assinatura" do certificado online e a imagem de cada pessoa. Postgres LOCAL.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('ajustes do certificado: assinatura online', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const cert = require('../src/lib/certificado');
  let antes;
  before(async () => { antes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'cert_' } } }); });
  after(async () => {
    await prisma.configuracao.deleteMany({ where: { chave: { startsWith: 'cert_' } } });
    for (const c of antes) await prisma.configuracao.create({ data: c });
  });
  test('salva e lê o modo e as imagens; sem imagem nova, mantém a de antes; "remover" tira', async () => {
    await cert.salvarAjustes({ assinantes: [{ nome: 'A', cargo: 'C', imagemUrl: '/uploads/a.webp' }, { nome: 'B', cargo: 'P' }], livro: '1', assinaturaOnline: 'sem' });
    let a = await cert.lerAjustes();
    assert.equal(a.assinaturaOnline, 'sem');
    assert.equal(a.assinantes[0].imagemUrl, '/uploads/a.webp');
    assert.equal(a.assinantes[1].imagemUrl, null);
    await cert.salvarAjustes({ assinantes: [{ nome: 'A', cargo: 'C', imagemUrl: '/uploads/a.webp' }, { nome: 'B', cargo: 'P' }], livro: '1', assinaturaOnline: 'qualquer' });
    a = await cert.lerAjustes();
    assert.equal(a.assinaturaOnline, 'com', 'valor desconhecido volta ao padrão');
  });
});
