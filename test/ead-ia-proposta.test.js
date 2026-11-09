// Criar curso com IA passo a passo (2026-11): a IA propõe o curso a partir da ideia (passo 2), a pessoa confere e
// confirma; dá para voltar do roteiro para a proposta. Postgres LOCAL e cliente falso.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/lib/ead-ia-esquema');
const { propostaBoa, roteiroBom, moduloBom, clienteFalso } = require('./helpers/ia-falso');

describe('validarProposta', () => {
  test('aceita a proposta boa', () => {
    const r = E.validarProposta(propostaBoa());
    assert.equal(r.ok, true);
    assert.equal(r.proposta.nome, 'Primeiros Socorros na Creche');
    assert.equal(r.proposta.nModulos, 4);
  });
  test('ajusta números fora da faixa', () => {
    const r = E.validarProposta(propostaBoa({ cargaHoraria: 900, nModulos: 40, maxParcelas: 0, precoSugerido: -5 }));
    assert.equal(r.ok, true);
    assert.deepEqual([r.proposta.cargaHoraria, r.proposta.nModulos, r.proposta.maxParcelas, r.proposta.precoSugerido], [600, 12, 1, 0]);
  });
  test('nome ou tema vazio é erro', () => {
    assert.equal(E.validarProposta(propostaBoa({ nome: ' ' })).ok, false);
    assert.equal(E.validarProposta(propostaBoa({ tema: '' })).ok, false);
  });
  test('o esquema da API fecha os objetos e lista os campos', () => {
    assert.equal(E.ESQUEMA_PROPOSTA.additionalProperties, false);
    assert.deepEqual(E.ESQUEMA_PROPOSTA.required.sort(), Object.keys(E.ESQUEMA_PROPOSTA.properties).sort());
  });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('proposta no banco e na fila', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const IA = require('../src/lib/ead-ia');
  const fila = require('../src/lib/ead-ia-fila');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-prop-${s}`;
  const chaveAntes = process.env.ANTHROPIC_API_KEY;
  const geracoes = [];
  let modoRuim = false;
  const cli = clienteFalso([(params) => {
    const pedido = params.messages[0].content.at(-1).text;
    if (/Proponha o curso/.test(pedido)) return modoRuim ? { nome: '' } : propostaBoa();
    const n = Number((pedido.match(/Escreva agora o módulo (\d+)/) || [])[1]);
    return n ? moduloBom(roteiroBom(4).modulos[n - 1]) : roteiroBom(4);
  }]);
  const nova = async (destino = { tipo: 'novo' }) => {
    const g = await IA.criarGeracao({ pedido: { ideia: 'Primeiros socorros para professores de creche', destino }, material: { materialTexto: null, materialPdfs: [] }, criadoPor: `${quem}-${geracoes.length}` });
    geracoes.push(g.id);
    return g;
  };

  before(() => { process.env.ANTHROPIC_API_KEY = 'chave-falsa'; fila.definirCliente(cli); });
  after(async () => {
    await fila.ocioso(); fila.definirCliente(null);
    if (chaveAntes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = chaveAntes;
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: geracoes } } });
    await prisma.geracaoIaEad.deleteMany({ where: { id: { in: geracoes } } });
    await prisma.$disconnect();
  });

  test('pedido com a ideia começa pela proposta; a fila faz a proposta antes do roteiro', async () => {
    const g = await nova();
    assert.equal(g.status, 'PROPOSTA_GERANDO');
    await fila.acordar(); await fila.ocioso();
    const d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'PROPOSTA_PRONTA');
    assert.equal(d.pedido.proposta.nome, 'Primeiros Socorros na Creche');
    assert.equal(d.pedido.ideia, 'Primeiros socorros para professores de creche');
    assert.ok(Number(d.custoUsd) > 0, 'a proposta tem custo');
  });

  test('proposta fora das regras vira ERRO_PROPOSTA; "tentar de novo" volta a gerar', async () => {
    modoRuim = true;
    const g = await nova();
    await fila.acordar(); await fila.ocioso();
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).status, 'ERRO_PROPOSTA');
    modoRuim = false;
    assert.deepEqual(await IA.pedirOutraProposta(g.id, quem), { ok: true });
    await fila.acordar(); await fila.ocioso();
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).status, 'PROPOSTA_PRONTA');
  });

  test('confirmar a proposta grava o pedido e passa ao roteiro; voltar do roteiro mantém a proposta', async () => {
    const g = await nova();
    await fila.acordar(); await fila.ocioso();
    const pedido = { tema: 'Tema confirmado', publico: 'professores', nModulos: 3, observacoes: 'obs', destino: { tipo: 'novo', nome: `Curso Prop ${s}`, descricao: 'd', cargaHoraria: 4, precoOnline: 39.9, maxParcelas: 2 } };
    assert.deepEqual(await IA.confirmarProposta(g.id, pedido, quem), { ok: true });
    let d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'ROTEIRO_GERANDO');
    assert.equal(d.pedido.tema, 'Tema confirmado');
    assert.equal(d.pedido.destino.nome, `Curso Prop ${s}`);
    assert.ok(d.pedido.proposta, 'a proposta fica guardada');
    await fila.acordar(); await fila.ocioso();
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).status, 'ROTEIRO_PRONTO');
    assert.deepEqual(await IA.voltarParaProposta(g.id, quem), { ok: true });
    d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'PROPOSTA_PRONTA');
    assert.equal(d.pedido.proposta.nome, 'Primeiros Socorros na Creche');
  });

  test('só confirma proposta pronta; cancelar vale na proposta', async () => {
    const g = await nova();
    assert.equal((await IA.confirmarProposta(g.id, { tema: 'x', nModulos: 3, destino: { tipo: 'novo' } }, quem)).ok, false, 'ainda gerando');
    assert.deepEqual(await IA.cancelar(g.id, quem), { ok: true });
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).status, 'CANCELADA');
  });

  test('proposta pronta conta como geração em andamento (uma por pessoa)', async () => {
    const g = await IA.criarGeracao({ pedido: { ideia: 'Outra ideia qualquer', destino: { tipo: 'novo' } }, material: { materialTexto: null, materialPdfs: [] }, criadoPor: `${quem}-unica` });
    geracoes.push(g.id);
    await fila.acordar(); await fila.ocioso();
    const r = await IA.podeComecar(`${quem}-unica`);
    assert.equal(r.ok, false);
  });
});
