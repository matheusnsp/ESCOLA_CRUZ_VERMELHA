// Etapa 9: fila da geração com IA (um passo por vez, conclusão, cancelamento no meio, retomada). Postgres LOCAL e
// cliente falso.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { roteiroBom, roteiroComum, moduloBom, clienteFalso, pedidosImagensBons, openaiFalso } = require('./helpers/ia-falso');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('fila da geração com IA', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const IA = require('../src/lib/ead-ia');
  const fila = require('../src/lib/ead-ia-fila');
  const s = String(Date.now()).slice(-7);
  let curso; let co; const geracoes = [];
  const rot = roteiroComum(3);
  const responde = () => (params) => {
    const pedido = params.messages[0].content.at(-1).text;
    if (/pedido da capa/.test(pedido)) return pedidosImagensBons([...pedido.matchAll(/moduloId: ([0-9a-f-]{36})/g)].map((x) => x[1])); // passo das imagens
    const n = Number((pedido.match(/Escreva agora o módulo (\d+)/) || [])[1]);
    return n ? moduloBom(rot.modulos[n - 1]) : roteiroBom(3);
  };

  // Geração já confirmada (MODULOS_GERANDO) no curso de teste.
  async function confirmada() {
    const g = await IA.criarGeracao({ pedido: { destino: { tipo: 'existente', cursoOnlineId: co.id }, tema: 'Tema', publico: '', nModulos: 3, observacoes: '' }, material: { materialTexto: null, materialPdfs: [{ nome: 'a.pdf', base64: 'QUJD' }] }, criadoPor: `fila-${s}` });
    geracoes.push(g.id);
    await IA.gerarRoteiro(g.id, { cliente: clienteFalso([() => roteiroBom(3)]) });
    const c = await IA.confirmarRoteiro(g.id, roteiroComum(3), 'dev');
    assert.equal(c.ok, true, c.erro);
    return g;
  }
  const doBanco = (g) => prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
  const modulosNoCurso = () => prisma.moduloEad.count({ where: { cursoOnlineId: co.id } });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Curso Fila IA ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
  });
  after(async () => {
    await fila.ocioso();
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: geracoes } } });
    await prisma.geracaoIaEad.deleteMany({ where: { id: { in: geracoes } } });
    const mods = await prisma.moduloEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true } });
    await prisma.cenarioEad.deleteMany({ where: { moduloId: { in: mods.map((m) => m.id) } } });
    await prisma.topicoEad.deleteMany({ where: { moduloId: { in: mods.map((m) => m.id) } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: co.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('geração confirmada: os 3 módulos são gravados, CONCLUIDA e o PDF apagado', async () => {
    const g = await confirmada();
    const antes = await modulosNoCurso();
    fila.acordar({ cliente: clienteFalso([responde()]) });
    await fila.ocioso();
    const d = await doBanco(g);
    assert.equal(d.status, 'CONCLUIDA');
    assert.equal(d.materialPdfs, null);
    assert.deepEqual(d.modulos.map((m) => m.status), ['pronto', 'pronto', 'pronto']);
    assert.equal(await modulosNoCurso(), antes + 3);
  });

  test('[2 ao mesmo tempo] dois módulos são escritos juntos (nunca mais de 2) e a ordem no curso segue o roteiro', async () => {
    const g = await confirmada();
    let agora = 0; let pico = 0; let soltar1; const m2Comecou = new Promise((r) => { soltar1 = r; });
    const cli = clienteFalso([async (params) => {
      agora++; pico = Math.max(pico, agora);
      const n = Number((params.messages[0].content.at(-1).text.match(/Escreva agora o módulo (\d+)/) || [])[1]);
      if (n === 2) soltar1();
      if (n === 1) await m2Comecou; // o módulo 1 só termina depois que o 2 começou: prova que rodam juntos
      await new Promise((r) => setTimeout(r, n === 1 ? 80 : 10)); // e o 2 termina antes do 1
      agora--;
      return responde()(params);
    }]);
    fila.acordar({ cliente: cli });
    await fila.ocioso();
    const d = await doBanco(g);
    assert.equal(d.status, 'CONCLUIDA');
    assert.equal(cli.chamadas.length, 4, '3 módulos + o pedido das imagens');
    assert.equal(pico, 2, 'dois ao mesmo tempo, nunca três');
    const noCurso = await prisma.moduloEad.findMany({ where: { id: { in: d.modulos.map((m) => m.moduloId) } }, orderBy: { ordem: 'asc' }, select: { titulo: true } });
    assert.deepEqual(noCurso.map((m) => m.titulo), rot.modulos.map((m) => m.titulo), 'ordem do roteiro, mesmo o 2 terminando antes');
  });

  test('[imagens] módulos prontos → passo "Gerando as imagens" → CONCLUIDA com capa e módulos com imagem', async () => {
    const chave = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'sk-teste';
    const img = require('../src/lib/ead-imagens');
    img.definirFetch(openaiFalso());
    try {
      const g = await confirmada();
      const vistos = new Set();
      const cli = clienteFalso([async (params) => {
        vistos.add((await doBanco(g)).status);
        return responde()(params);
      }]);
      fila.acordar({ cliente: cli });
      await fila.ocioso();
      const d = await doBanco(g);
      assert.equal(d.status, 'CONCLUIDA');
      assert.ok(vistos.has('FOTOS_GERANDO'), 'passou pelo passo das imagens');
      const mods = await prisma.moduloEad.findMany({ where: { id: { in: d.modulos.map((m) => m.moduloId) } } });
      assert.ok(mods.every((m) => m.fotoIntroUrl && m.fotoGeradaPorIa), 'módulos com imagem');
      assert.ok((await prisma.curso.findUnique({ where: { id: curso.id } })).imagemUrl, 'capa com imagem');
      assert.equal(d.pedido.avisoImagens, undefined);
    } finally {
      img.definirFetch(null);
      if (chave === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = chave;
      for (const m of await prisma.moduloEad.findMany({ where: { cursoOnlineId: co.id } })) await prisma.moduloEad.update({ where: { id: m.id }, data: { fotoIntroUrl: null } });
      await prisma.curso.update({ where: { id: curso.id }, data: { imagemUrl: null } });
    }
  });

  test('[imagens] Claude falha no passo das imagens → CONCLUIDA mesmo assim, com o aviso', async () => {
    const g = await confirmada();
    const cli = clienteFalso([(params) => {
      if (/pedido da capa/.test(params.messages[0].content.at(-1).text)) return { stop_reason: 'refusal' };
      return responde()(params);
    }]);
    fila.acordar({ cliente: cli });
    await fila.ocioso();
    const d = await doBanco(g);
    assert.equal(d.status, 'CONCLUIDA');
    assert.equal(d.pedido.avisoImagens, 'As imagens não puderam ser geradas; use o botão Gerar imagens com IA na página do curso.');
  });

  test('[imagens] curso online apagado antes do passo → CONCLUIDA sem erro', async () => {
    const g = await IA.criarGeracao({ pedido: { destino: { tipo: 'existente', cursoOnlineId: co.id }, tema: 'Tema', publico: '', nModulos: 3, observacoes: '' }, material: { materialTexto: null, materialPdfs: [] }, criadoPor: `fila-img-${s}` });
    geracoes.push(g.id);
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { status: 'FOTOS_GERANDO', cursoOnlineId: null } });
    fila.acordar({ cliente: clienteFalso([responde()]) });
    await fila.ocioso();
    assert.equal((await doBanco(g)).status, 'CONCLUIDA');
  });

  test('roteiro pendente também é processado pela fila', async () => {
    const g = await IA.criarGeracao({ pedido: { destino: { tipo: 'existente', cursoOnlineId: co.id }, tema: 'Tema', publico: '', nModulos: 3, observacoes: '' }, material: { materialTexto: null, materialPdfs: [] }, criadoPor: `fila2-${s}` });
    geracoes.push(g.id);
    fila.acordar({ cliente: clienteFalso([responde()]) });
    await fila.ocioso();
    assert.equal((await doBanco(g)).status, 'ROTEIRO_PRONTO');
  });

  test('[Review Focus 1] cancelar no meio de um módulo: ele termina e é gravado; o próximo não começa', async () => {
    const g = await confirmada();
    const antes = await modulosNoCurso();
    let soltar; const segurando = new Promise((r) => { soltar = r; });
    let chamadas = 0;
    const cli = clienteFalso([async (params) => {
      chamadas++;
      if (chamadas === 2) { await IA.cancelar(g.id, 'dev'); await segurando; }
      return responde()(params);
    }]);
    fila.acordar({ cliente: cli });
    while (chamadas < 2) await new Promise((r) => setTimeout(r, 10));
    soltar();
    await fila.ocioso();
    const d = await doBanco(g);
    assert.equal(d.status, 'CANCELADA');
    assert.deepEqual(d.modulos.map((m) => m.status), ['pronto', 'pronto', 'pendente']);
    assert.equal(await modulosNoCurso(), antes + 2);
    assert.equal(cli.chamadas.length, 2);
  });

  test('[Review Focus 5] retomar: módulo "gerando" volta a pendente e é refeito uma vez; os prontos não', async () => {
    const g = await confirmada();
    const cli1 = clienteFalso([responde()]);
    await IA.gerarModulo(g.id, 0, { cliente: cli1 });
    const d0 = await doBanco(g);
    const mods = d0.modulos.map((m) => (m.ordem === 1 ? { ...m, status: 'gerando' } : m)); // o servidor caiu no meio do módulo 2
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { modulos: mods } });
    const cli = clienteFalso([responde()]);
    await fila.retomar({ cliente: cli });
    await fila.ocioso();
    const d = await doBanco(g);
    assert.equal(d.status, 'CONCLUIDA');
    assert.equal(cli.chamadas.length, 3, 'refaz o módulo 2 e faz o 3 (o 1 já estava pronto) + o pedido das imagens');
    assert.equal(d.modulos[0].moduloId, d0.modulos[0].moduloId);
  });

  test('outro serviço escrevendo um módulo (marca recente): retomar não mexe nele; a outra vaga escreve os demais', async () => {
    const g = await confirmada();
    const d0 = await doBanco(g);
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { modulos: d0.modulos.map((m) => (m.ordem === 0 ? { ...m, status: 'gerando' } : m)) } });
    await prisma.configuracao.create({ data: { chave: `ead-ia:ocupado:${g.id}`, valor: String(Date.now()) } });
    const cli = clienteFalso([responde()]);
    await fila.retomar({ cliente: cli });
    await fila.ocioso();
    const d1 = await doBanco(g);
    assert.deepEqual(d1.modulos.map((m) => m.status), ['gerando', 'pronto', 'pronto'], 'o do outro serviço fica; os outros dois são escritos (2 por vez no total)');
    assert.equal(d1.status, 'MODULOS_GERANDO');
    assert.equal(cli.chamadas.length, 2);
    // marca velha (o outro serviço morreu): retoma
    await prisma.configuracao.update({ where: { chave: `ead-ia:ocupado:${g.id}` }, data: { valor: String(Date.now() - 11 * 60e3) } });
    await fila.retomar({ cliente: cli });
    await fila.ocioso();
    assert.equal((await doBanco(g)).status, 'CONCLUIDA');
    assert.equal(cli.chamadas.length, 4, 'só o módulo 1 é refeito; + o pedido das imagens');
    assert.equal(await prisma.configuracao.count({ where: { chave: { startsWith: `ead-ia:ocupado:${g.id}` } } }), 0, 'as marcas saem no fim');
  });

  test('acordar duas vezes seguidas não processa o mesmo módulo duas vezes', async () => {
    const g = await confirmada();
    const cli = clienteFalso([responde()]);
    fila.acordar({ cliente: cli });
    fila.acordar({ cliente: cli });
    await fila.ocioso();
    assert.equal(cli.chamadas.length, 4, '3 módulos + o pedido das imagens, cada um uma vez');
    assert.equal((await doBanco(g)).status, 'CONCLUIDA');
  });

  test('[revisão C1] serviço morreu no meio (marca vencida, módulo "gerando"): a varredura periódica destrava', async () => {
    const g = await confirmada();
    const d0 = await doBanco(g);
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { modulos: d0.modulos.map((m) => (m.ordem === 0 ? { ...m, status: 'gerando' } : m)) } });
    await prisma.configuracao.create({ data: { chave: `ead-ia:ocupado:${g.id}`, valor: `${Date.now() - 4 * 60e3}:morto` } });
    const cli = clienteFalso([responde()]);
    await fila.varrer({ cliente: cli });
    await fila.ocioso();
    assert.equal((await doBanco(g)).status, 'CONCLUIDA');
    assert.equal(cli.chamadas.length, 4, '3 módulos + o pedido das imagens');
    const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(server, /ead-ia-fila'\)\.agendar\(/, 'o servidor agenda a varredura');
  });

  test('[revisão I2] a marca é renovada durante a chamada à IA e só a própria é apagada', async () => {
    const g = await confirmada();
    fila.configurar({ renovarMs: 40 });
    const vistos = new Set();
    let roubar = false;
    const cli = clienteFalso([async (params) => {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 30));
        const m = await prisma.configuracao.findUnique({ where: { chave: `ead-ia:ocupado:${g.id}` } });
        if (m) vistos.add(m.valor);
      }
      if (roubar) await prisma.configuracao.update({ where: { chave: `ead-ia:ocupado:${g.id}` }, data: { valor: `${Date.now()}:outro-servico` } });
      return responde()(params);
    }]);
    try {
      await IA.gerarModulo(g.id, 0, { cliente: clienteFalso([responde()]) }); // só para ter um pronto
      roubar = false;
      fila.acordar({ cliente: cli });
      while (cli.chamadas.length < 1) await new Promise((r) => setTimeout(r, 10));
      roubar = true; // no fim da chamada, outro serviço passa a ter a marca
      await fila.ocioso();
    } finally {
      fila.configurar({ renovarMs: 60000 });
    }
    assert.ok(vistos.size >= 2, `a marca mudou durante a chamada (${vistos.size} valores)`);
    const m = await prisma.configuracao.findUnique({ where: { chave: `ead-ia:ocupado:${g.id}` } });
    assert.ok(m && m.valor.endsWith(':outro-servico'), 'a marca do outro serviço não foi apagada');
    await prisma.configuracao.delete({ where: { chave: `ead-ia:ocupado:${g.id}` } });
    await IA.cancelar(g.id, 'dev');
  });
});
