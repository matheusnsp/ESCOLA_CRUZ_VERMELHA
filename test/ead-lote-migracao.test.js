// Migração da etapa 6 (lote de escolas): só acrescenta, e o checador a aceita.
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

test('a migração ead_lote cria as 4 tabelas e passa no checador', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261109120000_ead_lote', 'migration.sql'), 'utf8');
  for (const t of ['EscolaEad', 'GestorEscolaEad', 'LoteEad', 'VagaLoteEad']) assert.match(sql, new RegExp(`CREATE TABLE "${t}"`));
  assert.equal(checa(sql), true);
});

test('o checador recusa coluna nova em Usuario', () => {
  assert.equal(checa('ALTER TABLE "Usuario" ADD COLUMN "escolaId" TEXT;\n'), false);
});
