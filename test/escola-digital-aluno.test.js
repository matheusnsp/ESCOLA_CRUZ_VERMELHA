// Escola Digital (2026-11), Task 1: a tela do aluno continua mostrando todos os módulos (decisão do Matheus);
// a proteção contra rascunho fica no painel: aviso de curso publicado ao criar ou mudar conteúdo.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const AVISO = 'Este curso está publicado: o que você criar ou mudar aqui aparece para os alunos na hora.';

describe('aviso de curso publicado no painel', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const pdb = require('../src/lib/ead-progresso-db');
  const s = String(Date.now()).slice(-7);
  let srv; let pub; let rasc; let modPub; let modRasc;

  before(async () => {
    const novo = async (nome, publicado) => {
      const c = await prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
      return prisma.cursoOnline.create({ data: { cursoId: c.id, publicado, precoOnline: 10 } });
    };
    pub = await novo('Curso Publicado Aviso', true);
    rasc = await novo('Curso Rascunho Aviso', false);
    modPub = await prisma.moduloEad.create({ data: { cursoOnlineId: pub.id, titulo: 'M rascunho', ordem: 0 } });
    modRasc = await prisma.moduloEad.create({ data: { cursoOnlineId: rasc.id, titulo: 'M', ordem: 0 } });
    srv = await ouvir(montarPainel(`dev-aviso-${s}`));
  });
  after(async () => { srv.server.close(); await apagarCursosOnline(prisma, [pub.id, rasc.id]); await prisma.$disconnect(); });

  const get = async (u) => (await fetch(srv.url + u)).text();

  test('curso publicado mostra o aviso na página do curso e do módulo', async () => {
    assert.ok((await get(`/ead/curso/${pub.id}`)).includes(AVISO));
    assert.ok((await get(`/ead/modulo/${modPub.id}`)).includes(AVISO));
  });

  test('curso não publicado não mostra o aviso', async () => {
    assert.ok(!(await get(`/ead/curso/${rasc.id}`)).includes(AVISO));
    assert.ok(!(await get(`/ead/modulo/${modRasc.id}`)).includes(AVISO));
  });

  test('tela do aluno inalterada: o rascunho continua no curso do aluno', async () => {
    const r = await pdb.carregarCursoParaAluno(pub.id);
    assert.ok(r.co.modulos.some((m) => m.id === modPub.id));
  });
});
