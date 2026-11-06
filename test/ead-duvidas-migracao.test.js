// Migração da etapa 5 (dúvidas e curso só online): só acrescenta, e o checador a aceita.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function checa(sql) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'migration.sql');
  fs.writeFileSync(f, sql);
  try { execFileSync('node', [path.join(__dirname, '..', 'scripts', 'checar-migracao-ead.js'), f], { stdio: 'pipe' }); return true; } catch (e) { return false; }
}

test('a migração ead_duvidas passa no checador', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261108120000_ead_duvidas', 'migration.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE "DuvidaEad"/);
  assert.match(sql, /ALTER TABLE "CursoOnline" ADD COLUMN\s+"somenteOnline" BOOLEAN NOT NULL DEFAULT false/);
  assert.equal(checa(sql), true);
});

test('o checador recusa a coluna nova em Curso', () => {
  assert.equal(checa('ALTER TABLE "Curso" ADD COLUMN "somenteOnline" BOOLEAN;\n'), false);
});
