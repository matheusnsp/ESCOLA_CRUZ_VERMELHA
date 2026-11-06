// Migração da etapa 7 (cupom e parcelas): só acrescenta, e o checador a aceita.
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

test('a migração ead_cupom cria as tabelas, a coluna maxParcelas e passa no checador', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261110120000_ead_cupom', 'migration.sql'), 'utf8');
  for (const t of ['CupomEad', 'CupomMatriculaEad']) assert.match(sql, new RegExp(`CREATE TABLE "${t}"`));
  assert.doesNotMatch(sql, /ALTER TABLE "Matricula"/);
  assert.match(sql, /CREATE UNIQUE INDEX "CupomEad_codigo_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "CupomMatriculaEad_matriculaId_key"/);
  assert.match(sql, /ALTER TABLE "CursoOnline" ADD COLUMN\s+"maxParcelas" INTEGER NOT NULL DEFAULT 1/);
  assert.equal(checa(sql), true);
});
