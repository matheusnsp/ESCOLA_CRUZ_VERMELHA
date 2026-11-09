// Criar curso com IA passo a passo (2026-11): as telas do painel. Passo 1 (só a ideia), passo 2 (proposta já
// preenchida, confirmar com as regras do formulário), voltar do roteiro, próximos passos. Postgres LOCAL e
// cliente falso na fila.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { propostaBoa, roteiroBom, moduloBom, clienteFalso } = require('./helpers/ia-falso');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('painel: criação com IA passo a passo', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const fila = require('../src/lib/ead-ia-fila');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-passos-${s}`;
  const chaveAntes = process.env.ANTHROPIC_API_KEY;
  let srv; let usado; let gid;
  const nomeProposto = `Curso Proposto ${s}`;
  const cli = clienteFalso([(params) => {
    const pedido = params.messages[0].content.at(-1).text;
    if (/Proponha o curso/.test(pedido)) return propostaBoa({ nome: nomeProposto });
    const n = Number((pedido.match(/Escreva agora o módulo (\d+)/) || [])[1]);
    return n ? moduloBom(roteiroBom(3).modulos[n - 1]) : roteiroBom(3);
  }]);
  const post = (u, campos) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos).toString() });
  const get = async (u) => (await fetch(srv.url + u)).text();

  before(async () => {
    process.env.ANTHROPIC_API_KEY = 'chave-falsa';
    fila.definirCliente(cli);
    const c = await prisma.curso.create({ data: { nome: `Curso Já Usado ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    usado = c;
    srv = await ouvir(montarPainel(quem));
  });
  after(async () => {
    srv.server.close();
    await fila.ocioso(); fila.definirCliente(null);
    if (chaveAntes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = chaveAntes;
    const gs = await prisma.geracaoIaEad.findMany({ where: { criadoPor: quem } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: gs.map((g) => g.id) } } });
    await prisma.geracaoIaEad.deleteMany({ where: { criadoPor: quem } });
    await apagarCursosOnline(prisma, gs.map((g) => g.cursoOnlineId).filter(Boolean));
    await prisma.curso.delete({ where: { id: usado.id } });
    await prisma.$disconnect();
  });

  test('passo 1: o formulário pede só a ideia (sem nome, preço nem tema)', async () => {
    const t = await get('/ead/ia/novo');
    assert.match(t, /name="ideia"/);
    assert.doesNotMatch(t, /name="nome"/);
    assert.doesNotMatch(t, /name="tema"/);
    assert.match(t, /1 Ideia/);
  });

  test('passo 1: ideia curta é recusada', async () => {
    const r = await post('/ead/ia/novo', { ideia: 'curto', destino: 'novo' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Conte a ideia em pelo menos 10 caracteres/);
  });

  test('passo 1 → 2: a ideia cria a geração e a proposta aparece preenchida', async () => {
    const r = await post('/ead/ia/novo', { ideia: 'Primeiros socorros para professores de creche', destino: 'novo' });
    assert.equal(r.status, 302);
    gid = (r.headers.get('location').match(/\/ead\/ia\/([0-9a-f-]{36})/) || [])[1];
    assert.ok(gid);
    await fila.acordar(); await fila.ocioso();
    const t = await get(`/ead/ia/${gid}`);
    assert.match(t, new RegExp(`name="nome"[^>]*value="${nomeProposto}"`));
    assert.match(t, /name="precoOnline"[^>]*value="49,90"/);
    assert.match(t, /O tema cabe em 4 módulos curtos/);
    assert.match(t, /Gerar roteiro/);
    assert.match(t, /Pedir outra proposta/);
  });

  test('passo 2: nome de curso já usado volta com o erro e com o que foi digitado', async () => {
    const r = await post(`/ead/ia/${gid}/proposta`, { nome: `Curso Já Usado ${s}`, descricao: 'd', cargaHoraria: '4', precoOnline: '39,90', maxParcelas: '2', tema: 'Tema editado', publico: 'p', nModulos: '3', observacoes: '' });
    assert.equal(r.status, 400);
    const t = await r.text();
    assert.match(t, /Já existe um curso com esse nome/);
    assert.match(t, /name="tema"[^>]*value="Tema editado"/);
  });

  test('passo 2 → 3: confirmar passa ao roteiro; "voltar à proposta" funciona antes da escrita', async () => {
    const r = await post(`/ead/ia/${gid}/proposta`, { nome: nomeProposto, descricao: 'd', cargaHoraria: '4', precoOnline: '39,90', maxParcelas: '2', tema: 'Tema confirmado', publico: 'p', nModulos: '3', observacoes: '' });
    assert.equal(r.status, 302);
    await fila.acordar(); await fila.ocioso();
    let d = await prisma.geracaoIaEad.findUnique({ where: { id: gid } });
    assert.equal(d.status, 'ROTEIRO_PRONTO');
    assert.match(await get(`/ead/ia/${gid}`), /Voltar à proposta/);
    assert.equal((await post(`/ead/ia/${gid}/voltar-proposta`, {})).status, 302);
    d = await prisma.geracaoIaEad.findUnique({ where: { id: gid } });
    assert.equal(d.status, 'PROPOSTA_PRONTA');
  });

  test('passo 4: na conclusão aparecem os próximos passos', async () => {
    await post(`/ead/ia/${gid}/proposta`, { nome: nomeProposto, descricao: 'd', cargaHoraria: '4', precoOnline: '39,90', maxParcelas: '2', tema: 'Tema confirmado', publico: 'p', nModulos: '3', observacoes: '' });
    await fila.acordar(); await fila.ocioso();
    const g = await prisma.geracaoIaEad.findUnique({ where: { id: gid } });
    const form = { 'ordem[0]': '0', 'ordem[1]': '1', 'ordem[2]': '2' };
    g.roteiro.modulos.forEach((m, i) => {
      form[`modulos[${i}][titulo]`] = m.titulo; form[`modulos[${i}][minutos]`] = String(m.minutos);
      if (m.final) { form[`modulos[${i}][final]`] = '1'; m.cenarios.forEach((c, k) => { form[`modulos[${i}][cenarios][${k}]`] = c.titulo; }); }
      else m.topicos.forEach((t, k) => { form[`modulos[${i}][topicos][${k}]`] = t.titulo; });
    });
    assert.equal((await post(`/ead/ia/${gid}/confirmar`, form)).status, 302);
    await fila.acordar(); await fila.ocioso();
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: gid } })).status, 'CONCLUIDA');
    const t = await get(`/ead/ia/${gid}`);
    assert.match(t, /Próximos passos/);
    assert.match(t, /<li class="feito"><span>✓<\/span> 4 Escrita/, 'concluída: os 4 passos com ✓');
    assert.match(t, /href="\/ead\/modulo\/[0-9a-f-]{36}"/);
  });
});
