// 2026-11-13: a turma Aberta vira Confirmada à 00:00 (Brasília) do dia de início, e o site para de aceitar
// inscrição no mesmo momento. A conferência roda de hora em hora, ao abrir Turmas no painel e no site.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ct = require('../src/lib/concluir-turmas');

test('meia-noite do dia seguinte em Brasília (UTC-3)', () => {
  assert.equal(ct.inicioDoDiaSeguinteBrasilia(new Date('2026-11-13T15:00:00Z')).toISOString(), '2026-11-14T03:00:00.000Z');
  // 23h30 de 13/11 em Brasília (02:30Z de 14/11) ainda é dia 13
  assert.equal(ct.inicioDoDiaSeguinteBrasilia(new Date('2026-11-14T02:30:00Z')).toISOString(), '2026-11-14T03:00:00.000Z');
  // 00:10 de 14/11 em Brasília
  assert.equal(ct.inicioDoDiaSeguinteBrasilia(new Date('2026-11-14T03:10:00Z')).toISOString(), '2026-11-15T03:00:00.000Z');
});

test('o site só lista turma cujo dia de início ainda não chegou (Brasília)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'cursos.js'), 'utf8');
  assert.match(src, /function turmasAbertas\(\)\s*\{\s*return \{ status: 'ABERTA', inicioPrevisto: \{ gte: inicioDoDiaSeguinteBrasilia\(\) \} \};/);
});

test('a conferência roda de hora em hora, no painel (Turmas) e no site', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.match(ler('server.js'), /setInterval\(atualizarStatusTurmas, 60 \* 60 \* 1000\)/);
  assert.match(ler('routes/admin.js'), /router\.get\('\/turmas'[\s\S]{0,200}await atualizarStatusTurmas\(\)/);
  assert.match(ler('routes/cursos.js'), /async function fecharTurmasVencidas\(\)\s*\{\s*await atualizarStatusTurmas\(\);/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('confirmar no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  let curso; const ids = {};
  // "Hoje" é o dia de Brasília (o servidor está em UTC: entre 21h e meia-noite de Brasília, o UTC já é o dia seguinte).
  const meioDia = (deslocDias) => {
    const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d + deslocDias, 12, 0, 0));
  };
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Meia-noite ${Date.now()}`, cargaHoraria: 8, precoAvista: 1, precoCheio: 1, valorParcela: 1, ativo: true } });
    for (const [k, d] of [['hoje', 0], ['amanha', 1], ['ontem', -1]]) {
      ids[k] = (await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: meioDia(d), vagas: 10, minimoAlunos: 0, status: 'ABERTA' } })).id;
    }
  });
  after(async () => { await prisma.turma.deleteMany({ where: { cursoId: curso.id } }); await prisma.curso.delete({ where: { id: curso.id } }); });

  test('confirma as de hoje e de ontem; a de amanhã continua Aberta', async () => {
    await ct.confirmarTurmasDoDia();
    const st = async (k) => (await prisma.turma.findUnique({ where: { id: ids[k] } })).status;
    assert.equal(await st('hoje'), 'CONFIRMADA');
    assert.equal(await st('ontem'), 'CONFIRMADA');
    assert.equal(await st('amanha'), 'ABERTA');
  });
});
