// Webinários (2026-11-13; spec §5): lembretes 24 h e 1 h antes, uma vez só, sem link da transmissão.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('lembretes do webinário', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const email = require('../src/lib/email');
  const { processarLembretesWebinario } = require('../src/lib/webinario-lembretes');
  const s = String(Date.now()).slice(-7);
  const H = 3600e3;
  const LINK = `https://zoom.us/j/lembrete${s}`;
  const INICIO = new Date('2031-07-10T22:00:00Z');
  let w; let gravado; let ana; let bia; let caio; const enviados = [];
  const orig = email.enviarWebinarLembrete;
  const meus = () => enviados.filter((e) => [ana, bia, caio].some((u) => u.email === e.para));

  before(async () => {
    email.enviarWebinarLembrete = async (para, nome, d) => { enviados.push({ para, ...d, corpo: JSON.stringify(d) }); };
    w = (await wb.salvar({ nome: `Lembrete ${s}`, gratuito: '1', duracaoMin: '60', publicado: '1', palavraCodigo: 'x', inicioEm: '2031-07-10T19:00', linkAoVivo: LINK })).webinario;
    gravado = (await wb.salvar({ nome: `Lembrete gravado ${s}`, gratuito: '1', duracaoMin: '60', publicado: '1', palavraCodigo: 'x', gravacaoUrl: 'https://youtu.be/dQw4w9WgXcQ' })).webinario;
    [ana, bia, caio] = await Promise.all(['ana', 'bia', 'caio'].map((n) => prisma.usuario.create({ data: { nome: n, email: `${n}-wl-${s}@teste.local`, papel: 'ALUNO' } })));
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: ana.id, criadoEm: new Date(INICIO.getTime() - 5 * 24 * H) } });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: bia.id, criadoEm: new Date(INICIO.getTime() - 30 * 60e3) } }); // a 30 min do início
    await prisma.inscricaoWebinario.create({ data: { webinarioId: gravado.id, usuarioId: caio.id } });
  });
  after(async () => {
    email.enviarWebinarLembrete = orig;
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id, caio.id] } } });
    for (const x of [w, gravado]) await wb.excluir(x.id);
    await prisma.$disconnect();
  });

  test('23 h antes: 1 lembrete de 24 h; de novo, nenhum; sem o link da transmissão', async () => {
    await processarLembretesWebinario(new Date(INICIO.getTime() - 23 * H));
    await processarLembretesWebinario(new Date(INICIO.getTime() - 23 * H));
    assert.deepEqual(meus().map((e) => [e.para, e.falta]), [[ana.email, '24h']]);
    assert.ok(!meus()[0].corpo.includes(LINK));
  });

  test('50 min antes: 1 lembrete de 1 h; inscrito a 30 min não recebe; só gravado ignorado', async () => {
    enviados.length = 0;
    await processarLembretesWebinario(new Date(INICIO.getTime() - 50 * 60e3));
    assert.deepEqual(meus().map((e) => [e.para, e.falta]), [[ana.email, '1h']]);
  });

  test('remarcado (lembretes zerados): saem de novo no horário novo; sem acesso não recebe', async () => {
    enviados.length = 0;
    const novo = new Date(INICIO.getTime() + 7 * 24 * H);
    await prisma.webinario.update({ where: { id: w.id }, data: { inicioEm: novo } });
    await prisma.inscricaoWebinario.updateMany({ where: { webinarioId: w.id }, data: { lembrete24hEm: null, lembrete1hEm: null } });
    await processarLembretesWebinario(new Date(novo.getTime() - 20 * H));
    assert.deepEqual(meus().map((e) => [e.para, e.falta]).sort(), [[ana.email, '24h'], [bia.email, '24h']].sort());
    // sem acesso (ex.: pago estornado): simulado tornando o webinário pago sem matrícula
    enviados.length = 0;
    await prisma.webinario.update({ where: { id: w.id }, data: { gratuito: false } });
    await processarLembretesWebinario(new Date(novo.getTime() - 40 * 60e3));
    assert.equal(meus().length, 0);
  });
});

test('server.js agenda os lembretes do webinário a cada 10 min', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.match(src, /require\('\.\/lib\/webinario-lembretes'\)\.agendarLembretesWebinario\(10\)/);
});
