// Turma online (lib/turma-online.js) e o checador de migração do EAD (etapa 4).
require('dotenv').config();
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const turmaOnline = require('../src/lib/turma-online'); // no topo: erro aqui derruba o arquivo

function checa(sql) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'migration.sql');
  fs.writeFileSync(f, sql);
  try { execFileSync('node', [path.join(__dirname, '..', 'scripts', 'checar-migracao-ead.js'), f], { stdio: 'pipe' }); return true; } catch (e) { return false; }
}

describe('checador da migração', () => {
  test('aceita o ADD VALUE ONLINE e colunas novas em CursoOnline', () => {
    assert.equal(checa(`ALTER TYPE "StatusTurma" ADD VALUE IF NOT EXISTS 'ONLINE';\nALTER TABLE "CursoOnline" ADD COLUMN "precoOnline" DECIMAL(10,2),\nADD COLUMN "publicado" BOOLEAN NOT NULL DEFAULT false;\n`), true);
  });
  test('recusa outros ALTER TYPE e colunas em tabela que não é do EAD', () => {
    assert.equal(checa(`ALTER TYPE "Papel" ADD VALUE 'X';\n`), false);
    assert.equal(checa(`ALTER TYPE "StatusTurma" ADD VALUE IF NOT EXISTS 'OUTRO';\n`), false);
    assert.equal(checa(`ALTER TABLE "Curso" ADD COLUMN "x" TEXT;\n`), false);
    assert.equal(checa(`ALTER TABLE "CursoOnline" DROP COLUMN "x";\n`), false);
  });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('turmaOnline', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  let curso; let co;
  after(async () => {
    if (co) { await prisma.turma.deleteMany({ where: { cursoId: curso.id } }); await prisma.cursoOnline.delete({ where: { id: co.id } }); await prisma.curso.delete({ where: { id: curso.id } }); }
    await prisma.$disconnect();
  });
  test('acha ou cria uma só, mesmo em paralelo', async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE turma online', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    const ts = await Promise.all([1, 2, 3, 4, 5].map(() => turmaOnline.turmaOnline(co)));
    assert.equal(new Set(ts.map((t) => t.id)).size, 1);
    assert.equal(await prisma.turma.count({ where: { cursoId: curso.id, status: 'ONLINE' } }), 1);
    const t = ts[0];
    assert.equal(t.status, 'ONLINE'); assert.equal(t.vagas, 9999); assert.equal(t.minimoAlunos, 0);
    assert.equal(new Date(t.inicioPrevisto).toISOString().slice(0, 10), '2099-12-31');
    assert.equal(turmaOnline.ehOnline(t), true);
    assert.equal(turmaOnline.ehOnline({ status: 'ABERTA' }), false);
    assert.equal((await turmaOnline.turmaOnline(co)).id, t.id);
  });
});
