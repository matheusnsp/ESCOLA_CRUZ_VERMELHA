// Webinários (2026-11-13; spec §6, §4, §8): fileira da vitrine, Minha conta e exclusão de conta.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('webinário na vitrine e em Minha conta', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const wb = require('../src/lib/webinario');
  const s = String(Date.now()).slice(-7);
  const AGORA = new Date('2031-08-01T12:00:00Z');
  let futuro; let longe; let passadoSem; let passadoCom; let soGravado; let ana; const criados = [];
  const cria = async (o) => { const w = (await wb.salvar({ gratuito: '1', duracaoMin: '60', publicado: '1', palavraCodigo: 'x', ...o })).webinario; criados.push(w); return w; };

  before(async () => {
    // Vitrine isolada: despublica temporariamente os webinários que já existam no banco local.
    longe = await cria({ nome: `Longe ${s}`, inicioEm: '2031-09-20T19:00' });
    futuro = await cria({ nome: `Futuro ${s}`, inicioEm: '2031-08-05T19:00' });
    passadoSem = await cria({ nome: `Passado sem ${s}`, inicioEm: '2031-07-01T19:00' });
    passadoCom = await cria({ nome: `Passado com ${s}`, inicioEm: '2031-07-02T19:00', gravacaoUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    soGravado = await cria({ nome: `Só gravado ${s}`, gravacaoUrl: 'https://youtu.be/dQw4w9WgXcQ', ordemVitrine: '-5' });
    ana = await prisma.usuario.create({ data: { nome: 'Ana Vitrine', email: `ana-wv-${s}@teste.local`, papel: 'ALUNO' } });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: futuro.id, usuarioId: ana.id } });
    await prisma.inscricaoWebinario.create({ data: { webinarioId: passadoCom.id, usuarioId: ana.id } });
    await prisma.presencaWebinario.create({ data: { webinarioId: passadoCom.id, usuarioId: ana.id } });
  });
  after(async () => {
    await prisma.usuario.deleteMany({ where: { id: ana.id } });
    for (const w of criados) await wb.excluir(w.id).catch(() => {});
    await prisma.$disconnect();
  });
  const nossos = (l) => l.filter((x) => criados.some((c) => c.id === x.id));

  test('ordem: próximos (mais perto primeiro), depois realizados com gravação e só gravados; realizado sem gravação fora', async () => {
    const v = nossos(await wb.daVitrine(AGORA, ana.id));
    assert.deepEqual(v.map((x) => x.id), [futuro.id, longe.id, soGravado.id, passadoCom.id]);
    assert.equal(v.find((x) => x.id === futuro.id).inscrito, true);
    assert.equal(v.find((x) => x.id === longe.id).inscrito, false);
    assert.equal(v.find((x) => x.id === soGravado.id).quando, null);
  });

  test('fileira: some sem webinários; cartão "Ao vivo · data" ou "Gravado", "Você está inscrito"', async () => {
    const vitrine = require('../src/lib/vitrine');
    const f = path.join(__dirname, '..', 'src', 'views', 'partials', 'ed-linha-webinarios.ejs');
    assert.equal((await ejs.renderFile(f, { webinarios: [], vitrine })).trim(), '');
    const h = await ejs.renderFile(f, { webinarios: nossos(await wb.daVitrine(AGORA, ana.id)), vitrine });
    assert.match(h, /Webinários/); assert.match(h, /Ao vivo · 05\/08 às 19h/); assert.match(h, /Gravado/); assert.match(h, /Você está inscrito/);
    assert.doesNotMatch(h, /vaga|restam|ocupad|null/i);
    assert.match(await require('fs').promises.readFile(path.join(__dirname, '..', 'src', 'views', 'escola-digital.ejs'), 'utf8'), /partials\/ed-linha-webinarios/);
  });

  test('Minha conta: meus webinários com link e certificado quando há presença', async () => {
    const m = await wb.meus(ana.id);
    const ids = m.map((x) => x.id);
    assert.ok(ids.includes(futuro.id) && ids.includes(passadoCom.id));
    assert.equal(m.find((x) => x.id === passadoCom.id).temCertificado, true);
    assert.equal(m.find((x) => x.id === futuro.id).temCertificado, false);
    const h = await ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'partials', 'conta-webinarios.ejs'), { webinarios: m, vitrine: require('../src/lib/vitrine') });
    assert.match(h, /Certificado/); assert.match(h, new RegExp(`/escola-digital/webinario/${wb.endereco(passadoCom.curso.nome)}/certificado`));
  });

  test('excluir conta: webinário pago não trava; inscrição e presença somem', async () => {
    const { contarEmAndamento, EM_ANDAMENTO } = require('../src/lib/excluir-conta');
    assert.match(JSON.stringify(EM_ANDAMENTO), /webinario/);
    const pago = await cria({ nome: `Pago ${s}`, gratuito: '', preco: '20', inicioEm: '2031-09-01T19:00' });
    const turma = await require('../src/lib/turma-online').turmaOnline({ cursoId: pago.cursoId });
    const u = await prisma.usuario.create({ data: { nome: 'Caio Pago', email: `caio-wv-${s}@teste.local`, papel: 'ALUNO' } });
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 20, valorTaxaMatricula: 0, taxaConfirmada: true, statusPagamento: 'PAGO' } });
    assert.equal(await contarEmAndamento(u.id), 0);
    await prisma.matricula.delete({ where: { id: m.id } });
    await prisma.usuario.delete({ where: { id: u.id } });
  });
});
