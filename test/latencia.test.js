// Transações do EAD com o banco "longe" (proxy com atraso na frente do Postgres local). No Render, cada
// ida ao Supabase leva dezenas de ms; uma transação interativa com várias idas estourava os 5 s padrão
// do Prisma (ver lib/turma-espera.js). lib/transacao.js dá folga; este teste prova que ela basta.
// LATENCIA_MS muda o atraso (padrão 40 ms em cada sentido).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const ATRASO = Number(process.env.LATENCIA_MS || 40);

describe(`transações do EAD com ${ATRASO} ms de latência`, { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const { PrismaClient } = require('@prisma/client');
  const { abrir } = require('./helpers/proxy-latencia');
  const caminhoDb = require.resolve('../src/db');
  const rapido = require('../src/db'); // monta e apaga o cenário de teste sem atraso
  let proxy; let lento; let pdb; let edb; let transacao;
  let curso; let co; let mod; let top; let mod2; let fin; let cen; let aluno; let ac;
  const alt = () => ({ create: [{ texto: 'certa', correta: true, ordem: 0 }, { texto: 'errada', correta: false, ordem: 1 }] });

  before(async () => {
    const url = new URL(process.env.DATABASE_URL);
    proxy = await abrir(Number(url.port || 5432), ATRASO, url.hostname === 'localhost' ? '127.0.0.1' : url.hostname);
    url.hostname = '127.0.0.1'; url.port = String(proxy.porta);
    lento = new PrismaClient({ datasources: { db: { url: rapido.urlDoPrisma(url.toString()) } } });
    // Os módulos abaixo passam a usar o cliente lento (técnica do require.cache).
    require.cache[caminhoDb].exports = lento;
    pdb = require('../src/lib/ead-progresso-db');
    edb = require('../src/lib/ead-db');
    ({ transacao } = require('../src/lib/transacao'));

    curso = await rapido.curso.create({ data: { nome: 'TESTE latência', cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await rapido.cursoOnline.create({ data: { cursoId: curso.id } });
    mod = await rapido.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    top = await rapido.topicoEad.create({ data: { moduloId: mod.id, titulo: 'T1', telas: { create: [{ titulo: 'a', ordem: 0 }] } } });
    for (let i = 0; i < 6; i++) await rapido.perguntaEad.create({ data: { topicoId: top.id, enunciado: `P${i}`, feedback: 'f', alternativas: alt() } });
    mod2 = await rapido.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M2', ordem: 1 } });
    const t2 = await rapido.topicoEad.create({ data: { moduloId: mod2.id, titulo: 'T2' } });
    for (let i = 0; i < 8; i++) await rapido.perguntaEad.create({ data: { topicoId: t2.id, enunciado: `Q${i}`, feedback: 'f', alternativas: alt() } });
    fin = await rapido.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'F', ordem: 2, final: true } });
    cen = await rapido.cenarioEad.create({ data: { moduloId: fin.id, titulo: 'C', decisoes: { create: [0, 1, 2].map((o) => ({ ordem: o, pergunta: `D${o}`, opcoes: { create: [0, 1].map((k) => ({ ordem: k, texto: `O${k}`, correta: k === 1, feedback: 'f' })) } })) } } });
    aluno = await rapido.usuario.create({ data: { nome: 'Aluno Latência', email: `lat-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    ac = await rapido.alunoCursoEad.create({ data: { usuarioId: aluno.id, cursoOnlineId: co.id } });
    await lento.$connect();
  });
  after(async () => {
    if (aluno) await rapido.usuario.deleteMany({ where: { id: aluno.id } });
    if (co) await rapido.cursoOnline.delete({ where: { id: co.id } });
    if (curso) await rapido.curso.delete({ where: { id: curso.id } });
    if (lento) await lento.$disconnect();
    await rapido.$disconnect();
    if (proxy) await proxy.fechar();
  });

  test('quiz inteiro: abrir e responder as 3 perguntas', async () => {
    const t = await pdb.abrirQuiz(ac.id, top.id);
    for (const pid of t.perguntaIds) {
      const certa = await rapido.alternativaEad.findFirst({ where: { perguntaId: pid, correta: true } });
      const r = await pdb.responder(t.id, ac.id, pid, [certa.id]);
      assert.equal(r.correta, true);
    }
    assert.equal((await rapido.tentativaEad.findUnique({ where: { id: t.id } })).aprovado, true);
  });

  test('pré-teste abre', async () => {
    const t = await pdb.abrirPreTeste(ac.id, mod2.id);
    assert.equal(t.perguntaIds.length, 8);
  });

  test('cenário até o fim, com um erro no meio', async () => {
    let feito = await pdb.comecarCenario(ac.id, cen.id);
    const decisoes = await rapido.decisaoCenario.findMany({ where: { cenarioId: cen.id }, orderBy: { ordem: 'asc' }, include: { opcoes: { orderBy: { ordem: 'asc' } } } });
    const errada = await pdb.escolherNoCenario(ac.id, cen.id, decisoes[0].id, decisoes[0].opcoes[0].id, pdb.jogadaDe(feito));
    assert.equal(errada.certa, false); feito = errada.feito;
    let r;
    for (const d of decisoes) { r = await pdb.escolherNoCenario(ac.id, cen.id, d.id, d.opcoes[1].id, pdb.jogadaDe(feito)); feito = r.feito; }
    assert.equal(r.fechou, true);
  });

  test('escrita do painel (como escrever de ead.js): cria tela e volta o módulo a rascunho', async () => {
    await transacao(async (tx) => {
      await tx.telaEad.create({ data: { topicoId: top.id, titulo: 'nova', ordem: await edb.proximaOrdem(tx, 'telaEad', 'topicoId', top.id) } });
      await edb.invalidarSeValidado(tx, mod.id, 'SISTEMA', 'nova tela');
    });
    assert.equal((await rapido.moduloEad.findUnique({ where: { id: mod.id } })).status, 'RASCUNHO');
  });
});
