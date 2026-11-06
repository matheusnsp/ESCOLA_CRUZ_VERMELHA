// Etapa 9 (criar curso com IA): a migração só acrescenta, o checador aceita, e as bibliotecas novas carregam.
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

test('a migração ead_ia cria GeracaoIaEad, acrescenta geradoPorIa e passa no checador', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261111120000_ead_ia', 'migration.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE "GeracaoIaEad"/);
  assert.match(sql, /ALTER TABLE "ModuloEad" ADD COLUMN\s+"geradoPorIa" BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /ALTER TABLE "(Matricula|Curso|Usuario|Pagamento|Turma)"/);
  assert.equal(checa(sql), true);
});

test('SDK da Anthropic e mammoth carregam; o .docx da fixture vira texto', async () => {
  assert.equal(typeof require('@anthropic-ai/sdk'), 'function');
  const mammoth = require('mammoth');
  const r = await mammoth.extractRawText({ path: path.join(__dirname, 'fixtures', 'material-ia.docx') });
  assert.match(r.value, /cinco golpes/);
});
