const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const arquivo = path.join(__dirname, '../../prisma/migrations/20261027120000_escola_digital/migration.sql');

test('migração só acrescenta', () => {
  const sql = fs.readFileSync(arquivo, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\b|\bRENAME\b|ALTER COLUMN|SET NOT NULL/i);
  const alteracoesCurso = sql.split(';').filter((s) => /ALTER TABLE "Curso"/.test(s));
  assert.ok(alteracoesCurso.length > 0, 'esperava ALTER TABLE "Curso" ... ADD COLUMN');
  for (const l of alteracoesCurso) assert.match(l, /ADD COLUMN/);
});

test('migração só usa CREATE TYPE/TABLE/INDEX e ALTER TABLE ADD', () => {
  const sql = fs.readFileSync(arquivo, 'utf8')
    .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  for (const cmd of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    assert.match(cmd, /^(CREATE TYPE|CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE "\w+" ADD (COLUMN|CONSTRAINT))/, cmd.slice(0, 80));
  }
});
