// Etapa 8: o guia de publicação e o roteiro de deploy existem e citam o essencial.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', 'docs', 'ead', f), 'utf8');

test('guia "como publicar um curso"', () => {
  const g = ler('como-publicar-um-curso.md');
  for (const t of ['link de teste', 'Validar', 'Publicar', 'Parcelas no cartão', 'Cupons', 'Curso só online']) assert.ok(g.includes(t), t);
});

test('roteiro de deploy cita backup, _prisma_migrations e cada migração do EAD', () => {
  const d = ler('deploy.md');
  for (const t of ['backup', '_prisma_migrations', 'prisma migrate deploy', 'link de teste']) assert.ok(d.toLowerCase().includes(t.toLowerCase()), t);
  const migs = fs.readdirSync(path.join(__dirname, '..', 'prisma', 'migrations')).filter((m) => /_ead_/.test(m));
  assert.equal(migs.length, 6);
  for (const m of migs) assert.ok(d.includes(m), m);
});
