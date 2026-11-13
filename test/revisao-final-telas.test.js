// 2026-11-13: correções da revisão final das telas novas de Cursos e Turmas.
require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = (router) => {
  const a = express();
  a.use((req, res, next) => { req.session = {}; res.locals.pode = () => true; next(); });
  a.use(router);
  a.use((err, req, res, next) => res.status(500).send('erro: ' + err.message)); // o handler de erro do server
  return new Promise((r) => { const s = a.listen(0, () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
};

test('[revisão I1] erro dentro das rotas novas vira página de erro (não fica carregando)', async () => {
  const prisma = require('../src/db');
  const orig = { t: prisma.turma.findUnique, c: prisma.curso.findUnique };
  prisma.turma.findUnique = async () => { throw new Error('banco caiu'); };
  prisma.curso.findUnique = async () => { throw new Error('banco caiu'); };
  const opt = { requirePermissao: () => (q, r, n) => n(), auditar: async () => {} };
  const t = await app(require('../src/routes/painel-turmas')(opt));
  const c = await app(require('../src/routes/painel-cursos')(opt));
  try {
    const id = '11111111-2222-3333-4444-555555555555';
    const r1 = await fetch(`${t.url}/turmas/${id}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(r1.status, 500);
    const r2 = await fetch(`${c.url}/cursos/${id}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(r2.status, 500);
  } finally { prisma.turma.findUnique = orig.t; prisma.curso.findUnique = orig.c; t.s.close(); c.s.close(); }
});

test('[revisão I2] curso da IA: o mais parecido; empate deixa em branco', () => {
  const { escolherCurso } = require('../src/lib/ia-comecar');
  const cursos = [{ id: 'a', nome: 'Primeiros Socorros Básico' }, { id: 'b', nome: 'Primeiros Socorros Infantil' }, { id: 'c', nome: 'Socorrista' }];
  assert.equal(escolherCurso(cursos, 'socorrista'), cursos[2]);
  assert.equal(escolherCurso(cursos, 'Primeiros Socorros Infantil'), cursos[1]);
  assert.equal(escolherCurso(cursos, 'Primeiros Socorros'), null, 'dois iguais: não escolhe');
  assert.equal(escolherCurso(cursos, ''), null);
});

test('[revisão M1→I] links antigos vão direto para a seção certa do curso', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['src/lib/certificado.js', 'src/views/admin/turma-certificados.ejs', 'src/views/admin/comprovantes-saude.ejs']) assert.doesNotMatch(ler(f), /\/editar#/, f);
  assert.match(ler('src/lib/certificado.js'), /\/cursos\/\$\{[^}]+\}\/certificado/);
  assert.match(ler('src/views/admin/comprovantes-saude.ejs'), /\/publicacao/);
});

test('[revisão M2→I] edição de curso sem seção conhecida nunca vira "Abrir Novo curso"; pedido da imagem é da Página', () => {
  const S = require('../src/lib/curso-secoes');
  assert.deepEqual(S.secoesDosCampos({ pedido: 'foto com manequim' }).map((x) => x.secao), ['pagina']);
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'admin-assistente.js'), 'utf8');
  assert.match(js, /editar && !\(prop\.editar\.secoes && prop\.editar\.secoes\.length\) && prop\.formulario === 'curso'/);
});
