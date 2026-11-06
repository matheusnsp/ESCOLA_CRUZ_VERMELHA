// Etapa 9: gerador do curso com IA (material, pedido ao Claude, roteiro, módulos, teto). Postgres LOCAL e cliente
// falso: nenhum teste chama a API de verdade.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { roteiroBom, moduloBom, clienteFalso } = require('./helpers/ia-falso');

const IA = require('../src/lib/ead-ia');

test('prepararMaterial: Word vira texto, PDF vira base64, texto colado por último', async () => {
  const docx = fs.readFileSync(path.join(__dirname, 'fixtures', 'material-ia.docx'));
  const pdf = Buffer.from('%PDF-1.4 falso');
  const m = await IA.prepararMaterial({ arquivos: [{ nome: 'apostila.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx }, { nome: 'guia.pdf', mimetype: 'application/pdf', buffer: pdf }], texto: 'Ligue 192.' });
  assert.match(m.materialTexto, /cinco golpes/);
  assert.match(m.materialTexto, /Texto colado:\s*Ligue 192\./);
  assert.ok(m.materialTexto.indexOf('cinco golpes') < m.materialTexto.indexOf('Texto colado:'));
  assert.deepEqual(m.materialPdfs, [{ nome: 'guia.pdf', base64: pdf.toString('base64') }]);
  assert.deepEqual(await IA.prepararMaterial({ arquivos: [], texto: '' }), { materialTexto: null, materialPdfs: [] });
});

test('montarMensagens: PDFs, depois o texto do material com cache, depois o pedido; system fixo', () => {
  const g = { materialTexto: 'Material X', materialPdfs: [{ nome: 'a.pdf', base64: 'QUJD' }] };
  const a = IA.montarMensagens(g, 'Pedido 1');
  const b = IA.montarMensagens(g, 'Pedido 2');
  assert.deepEqual(a.system, b.system);
  assert.deepEqual(a.system[0].cache_control, { type: 'ephemeral' });
  const c = a.messages[0].content;
  assert.equal(a.messages.length, 1);
  assert.equal(c[0].type, 'document');
  assert.deepEqual(c[0].source, { type: 'base64', media_type: 'application/pdf', data: 'QUJD' });
  assert.equal(c[1].type, 'text'); assert.match(c[1].text, /Material X/);
  assert.deepEqual(c[1].cache_control, { type: 'ephemeral' });
  assert.equal(c[2].text, 'Pedido 1');
  assert.equal(c[2].cache_control, undefined);
  const sem = IA.montarMensagens({ materialTexto: null, materialPdfs: [] }, 'Só o pedido');
  assert.deepEqual(sem.messages[0].content, [{ type: 'text', text: 'Só o pedido' }]);
});

test('chamarClaude: parâmetros da API, recusa, max_tokens e JSON inválido', async () => {
  const ok = clienteFalso([() => ({ modulos: [] })]);
  const r = await IA.chamarClaude(ok, { system: [], messages: [], schema: { type: 'object' } });
  assert.deepEqual(r.json, { modulos: [] });
  assert.equal(r.usage.output_tokens, 2000);
  const p = ok.chamadas[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, 32000);
  assert.deepEqual(p.thinking, { type: 'adaptive' });
  assert.equal(p.output_config.effort, 'high');
  assert.deepEqual(p.output_config.format, { type: 'json_schema', schema: { type: 'object' } });
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  const falha = async (resposta) => { try { await IA.chamarClaude(clienteFalso([() => resposta]), { system: [], messages: [], schema: {} }); return null; } catch (e) { return e; } };
  const recusa = await falha({ stop_reason: 'refusal', stop_details: { category: 'bio' } });
  assert.equal(recusa.message, 'A IA recusou: bio'); assert.ok(recusa.usage, 'a recusa também tem custo');
  assert.equal((await falha({ stop_reason: 'refusal', stop_details: null })).message, 'A IA recusou o pedido.');
  assert.equal((await falha({ stop_reason: 'max_tokens' })).message, 'A resposta da IA ficou longa demais.');
  assert.equal((await falha('isto não é JSON')).message, 'A IA devolveu uma resposta fora do formato.');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('gerador no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  let cursoEx; let coEx; const geracoes = []; const cursosCriados = [];
  const chaveAntes = process.env.ANTHROPIC_API_KEY;

  const novaGeracao = async (pedidoExtra = {}) => {
    const g = await IA.criarGeracao({ pedido: { destino: { tipo: 'existente', cursoOnlineId: coEx.id }, tema: 'Primeiros socorros na escola', publico: 'professores', nModulos: 3, observacoes: '', ...pedidoExtra }, material: { materialTexto: 'Material', materialPdfs: [] }, criadoPor: `dev-ia-${s}` });
    geracoes.push(g.id);
    return g;
  };

  before(async () => {
    process.env.ANTHROPIC_API_KEY = 'chave-falsa-teste';
    cursoEx = await prisma.curso.create({ data: { nome: `Curso IA Existente ${s}`, cargaHoraria: 4, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    coEx = await prisma.cursoOnline.create({ data: { cursoId: cursoEx.id } });
    for (const o of [0, 1]) await prisma.moduloEad.create({ data: { cursoOnlineId: coEx.id, titulo: `Antigo ${o}`, ordem: o, status: 'VALIDADO' } });
  });
  after(async () => {
    if (chaveAntes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = chaveAntes;
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: geracoes } } });
    await prisma.geracaoIaEad.deleteMany({ where: { id: { in: geracoes } } });
    const cos = [coEx.id, ...cursosCriados.map((c) => c.co)];
    for (const coId of cos) {
      const mods = await prisma.moduloEad.findMany({ where: { cursoOnlineId: coId }, select: { id: true } });
      await prisma.cenarioEad.deleteMany({ where: { moduloId: { in: mods.map((m) => m.id) } } });
      await prisma.topicoEad.deleteMany({ where: { moduloId: { in: mods.map((m) => m.id) } } });
      await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: coId } });
    }
    await prisma.cursoOnline.deleteMany({ where: { id: { in: cos } } });
    await prisma.curso.deleteMany({ where: { id: { in: [cursoEx.id, ...cursosCriados.map((c) => c.curso)] } } });
    await prisma.$disconnect();
  });

  test('gerarRoteiro: grava ROTEIRO_PRONTO, tokens e custo; roteiro inválido ⇒ ERRO_ROTEIRO', async () => {
    const g = await novaGeracao();
    await IA.gerarRoteiro(g.id, { cliente: clienteFalso([() => roteiroBom(3)]) });
    let d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'ROTEIRO_PRONTO');
    assert.equal(d.roteiro.modulos.length, 3);
    assert.equal(d.tokensSaida, 2000);
    assert.ok(Number(d.custoUsd) > 0);
    const g2 = await novaGeracao();
    await IA.gerarRoteiro(g2.id, { cliente: clienteFalso([() => roteiroBom(1)]) });
    d = await prisma.geracaoIaEad.findUnique({ where: { id: g2.id } });
    assert.equal(d.status, 'ERRO_ROTEIRO');
    assert.equal(d.erro, 'O roteiro precisa de 2 a 12 módulos.');
    assert.ok(Number(d.custoUsd) > 0, 'a chamada custou mesmo com o roteiro ruim');
  });

  test('confirmarRoteiro: valida; curso existente; curso novo com preço e parcelas', async () => {
    const g = await novaGeracao();
    await IA.gerarRoteiro(g.id, { cliente: clienteFalso([() => roteiroBom(3)]) });
    assert.deepEqual(await IA.confirmarRoteiro(g.id, roteiroBom(1), 'dev'), { ok: false, erro: 'O roteiro precisa de 2 a 12 módulos.' });
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).status, 'ROTEIRO_PRONTO');
    const r = await IA.confirmarRoteiro(g.id, roteiroBom(3), 'dev');
    assert.equal(r.ok, true, r.erro);
    const d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'MODULOS_GERANDO');
    assert.equal(d.cursoOnlineId, coEx.id);
    assert.deepEqual(d.modulos.map((m) => [m.ordem, m.status]), [[0, 'pendente'], [1, 'pendente'], [2, 'pendente']]);

    const gn = await novaGeracao({ destino: { tipo: 'novo', nome: `Curso Novo IA ${s}`, descricao: 'Curso gerado no teste.', cargaHoraria: 6, precoOnline: 59.9, maxParcelas: 4 } });
    await IA.gerarRoteiro(gn.id, { cliente: clienteFalso([() => roteiroBom(2)]) });
    assert.equal((await IA.confirmarRoteiro(gn.id, roteiroBom(2), 'dev')).ok, true);
    const dn = await prisma.geracaoIaEad.findUnique({ where: { id: gn.id } });
    const co = await prisma.cursoOnline.findUnique({ where: { id: dn.cursoOnlineId }, include: { curso: true } });
    cursosCriados.push({ co: co.id, curso: co.cursoId });
    assert.equal(co.somenteOnline, true);
    assert.equal(Number(co.precoOnline), 59.9);
    assert.equal(co.maxParcelas, 4);
    assert.equal(co.curso.nome, `Curso Novo IA ${s}`);
  });

  test('gerarModulo: grava no fim do curso existente, em rascunho, com os campos mapeados; antigos não mudam', async () => {
    const g = await novaGeracao();
    await IA.gerarRoteiro(g.id, { cliente: clienteFalso([() => roteiroBom(3)]) });
    await IA.confirmarRoteiro(g.id, roteiroBom(3), 'dev');
    const rot = roteiroBom(3);
    const cli = clienteFalso([() => moduloBom(rot.modulos[0]), () => moduloBom(rot.modulos[2])]);
    await IA.gerarModulo(g.id, 0, { cliente: cli });
    await IA.gerarModulo(g.id, 2, { cliente: cli });
    const d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.deepEqual(d.modulos.map((m) => m.status), ['pronto', 'pendente', 'pronto']);
    const mod = await prisma.moduloEad.findUnique({ where: { id: d.modulos[0].moduloId }, include: { topicos: { orderBy: { ordem: 'asc' }, include: { telas: { orderBy: { ordem: 'asc' } }, perguntas: { include: { alternativas: { orderBy: { ordem: 'asc' } } } } } } } });
    assert.equal(mod.status, 'RASCUNHO');
    assert.equal(mod.geradoPorIa, true);
    assert.ok(mod.ordem >= 2, 'depois dos módulos que já existiam');
    assert.equal(mod.titulo, 'Módulo 1');
    assert.equal(mod.introducao, 'Neste módulo: Módulo 1.');
    assert.equal(mod.topicos.length, 3);
    const tela = mod.topicos[0].telas[0];
    assert.equal(tela.ancora, 'Texto da tela 1.');
    assert.equal(tela.alerta, 'Não mova a vítima sem necessidade.');
    assert.deepEqual(tela.revisaoItens, ['Olhar', 'Ligar 192']);
    const p = mod.topicos[0].perguntas[0];
    assert.equal(p.feedback, 'Porque garante a segurança da cena.');
    assert.equal(p.alternativas.length, 4);
    assert.equal(p.alternativas.filter((a) => a.correta).length, 1);
    const fim = await prisma.moduloEad.findUnique({ where: { id: d.modulos[2].moduloId }, include: { cenarios: { include: { decisoes: { include: { opcoes: true } } } } } });
    assert.equal(fim.final, true);
    assert.equal(fim.cenarios.length, 2);
    assert.equal(fim.cenarios[0].decisoes.length, 3);
    assert.equal(fim.cenarios[0].decisoes[0].opcoes.filter((o) => o.correta).length, 1);
    assert.equal(fim.cenarios[0].decisoes[0].opcoes.find((o) => o.correta).feedback, 'É o passo certo.');
    const antigos = await prisma.moduloEad.findMany({ where: { cursoOnlineId: coEx.id, geradoPorIa: false }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(antigos.map((m) => [m.titulo, m.ordem, m.status]), [['Antigo 0', 0, 'VALIDADO'], ['Antigo 1', 1, 'VALIDADO']]);
    const antes = cli.chamadas.length;
    await IA.gerarModulo(g.id, 0, { cliente: cli });
    assert.equal(cli.chamadas.length, antes, 'módulo pronto não chama a IA de novo');
  });

  test('gerarModulo com resposta fora das regras: erro, nada gravado', async () => {
    const g = await novaGeracao();
    await IA.gerarRoteiro(g.id, { cliente: clienteFalso([() => roteiroBom(3)]) });
    await IA.confirmarRoteiro(g.id, roteiroBom(3), 'dev');
    const ruim = moduloBom(roteiroBom(3).modulos[1]); ruim.topicos[0].perguntas[0].alternativas.forEach((a) => { a.correta = true; });
    const antes = await prisma.moduloEad.count({ where: { cursoOnlineId: coEx.id } });
    await IA.gerarModulo(g.id, 1, { cliente: clienteFalso([() => ruim]) });
    const d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.modulos[1].status, 'erro');
    assert.match(d.modulos[1].erro, /uma alternativa correta/);
    assert.equal(await prisma.moduloEad.count({ where: { cursoOnlineId: coEx.id } }), antes);
    await IA.tentarDeNovo(g.id, 1, 'dev');
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).modulos[1].status, 'pendente');
  });

  test('podeComecar: chave, teto e geração em andamento', async () => {
    const quem = `dev-ia-${s}`;
    assert.equal((await IA.podeComecar(`outro-${s}`)).ok, true);
    assert.equal((await IA.podeComecar(quem)).ok, false, 'a mesma pessoa já tem geração em andamento');
    delete process.env.ANTHROPIC_API_KEY;
    assert.deepEqual(await IA.podeComecar(`outro-${s}`), { ok: false, erro: 'Configure a chave da API da Anthropic (ANTHROPIC_API_KEY) no servidor.' });
    process.env.ANTHROPIC_API_KEY = 'chave-falsa-teste';
    const gasto = await IA.gastoDoMes();
    const g = await novaGeracao();
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { custoUsd: Math.max(0, 50 - gasto) + 0.01, status: 'CONCLUIDA' } });
    assert.deepEqual(await IA.podeComecar(`outro-${s}`), { ok: false, erro: 'O teto de gasto com IA deste mês (US$ 50.00) foi atingido.' });
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { custoUsd: 0 } });
  });
});
