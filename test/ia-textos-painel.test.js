// Escrever com IA (2026-11-09), Task 2: o botão nos formulários do curso só online (rota JSON, dúvidas marcadas
// gravadas ao salvar) e "Gerar imagem com IA" no "Dados do curso". Postgres LOCAL; Claude e OpenAI falsos.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { montarPainel, ouvir, apagarCursosOnline } = require('./helpers/painel-ead');
const { clienteFalso, pedidosImagensBons, openaiFalso } = require('./helpers/ia-falso');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('painel: escrever com IA (curso online)', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const txt = require('../src/lib/ia-textos');
  const img = require('../src/lib/ead-imagens');
  const IA = require('../src/lib/ead-ia');
  const { uploadsDir } = require('../src/lib/upload');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-txt-${s}`;
  const amb = { o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY };
  let srv; let chamadas = 0; let tetoAntes; let custoAntes; let contAntes; const cos = [];
  const faq = (i) => ({ pergunta: `Pergunta ${i}?`, resposta: `Resposta ${i}.` });

  const post = (u, dados = {}) => fetch(srv.url + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', ...dados }) });
  const get = async (u) => (await fetch(srv.url + u)).text();

  before(async () => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-teste'; process.env.OPENAI_API_KEY = 'sk-teste';
    tetoAntes = await prisma.configuracao.findUnique({ where: { chave: 'ead-ia:teto-mensal-usd' } });
    custoAntes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'ead-ia:custo-avulso:' } } });
    contAntes = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'ead-ia:imagens:' } } });
    txt.definirCliente(clienteFalso([() => { chamadas++; return { descricao: 'Descrição escrita pela IA.', faqs: [faq(1), faq(2), faq(3), faq(4), faq(5)] }; }]));
    img.definirCliente(clienteFalso([() => pedidosImagensBons([])]));
    img.definirFetch(openaiFalso());
    srv = await ouvir(montarPainel(quem));
  });
  after(async () => {
    srv.server.close();
    txt.definirCliente(null); img.definirCliente(null); img.definirFetch(null);
    for (const [k, v] of Object.entries({ OPENAI_API_KEY: amb.o, ANTHROPIC_API_KEY: amb.a })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await prisma.configuracao.deleteMany({ where: { OR: [{ chave: 'ead-ia:teto-mensal-usd' }, { chave: { startsWith: 'ead-ia:custo-avulso:' } }, { chave: { startsWith: 'ead-ia:imagens:' } }] } });
    for (const x of [tetoAntes, ...custoAntes, ...contAntes].filter(Boolean)) await prisma.configuracao.create({ data: x });
    const cursos = await prisma.cursoOnline.findMany({ where: { id: { in: cos } }, select: { curso: { select: { imagemUrl: true } } } });
    for (const c of cursos) if (c.curso.imagemUrl) fs.rmSync(path.join(uploadsDir, path.basename(c.curso.imagemUrl)), { force: true });
    await prisma.faqCurso.deleteMany({ where: { curso: { online: { id: { in: cos } } } } });
    await prisma.logAuditoria.deleteMany({ where: { atorId: quem } });
    await apagarCursosOnline(prisma, cos);
  });

  test('POST /ead/ia-textos devolve os textos e soma o custo avulso', async () => {
    const antes = await IA.gastoDoMes();
    const r = await post('/ead/ia-textos', { tipo: 'online', nome: `Curso Txt ${s}`, cargaHoraria: '4', ideias: 'para pais' });
    const j = await r.json();
    assert.equal(j.ok, true, j.erro);
    assert.equal(j.textos.descricao, 'Descrição escrita pela IA.');
    assert.equal(j.textos.faqs.length, 5);
    assert.ok((await IA.gastoDoMes()) > antes);
  });

  test('teto estourado: {ok:false} sem chamar o Claude', async () => {
    await IA.definirTeto('0', quem);
    const n = chamadas;
    const j = await (await post('/ead/ia-textos', { tipo: 'online', nome: 'X' })).json();
    assert.equal(j.ok, false);
    assert.match(j.erro, /teto/i);
    assert.equal(chamadas, n);
    await IA.definirTeto('50', quem);
  });

  test('criar curso só online com 3 dúvidas (2 marcadas) grava 2; editar acrescenta as marcadas', async () => {
    const dados = { nome: `Curso Txt Criar ${s}`, cargaHoraria: '3', descricao: 'd',
      'faqsIa[0][usar]': '1', 'faqsIa[0][pergunta]': 'Quem pode fazer?', 'faqsIa[0][resposta]': 'Qualquer pessoa.',
      'faqsIa[1][pergunta]': 'Não marcada?', 'faqsIa[1][resposta]': 'n',
      'faqsIa[2][usar]': '1', 'faqsIa[2][pergunta]': 'Tem certificado?', 'faqsIa[2][resposta]': 'Sim, ao concluir.' };
    const fd = new FormData(); for (const [k, v] of Object.entries({ _csrf: 'x', ...dados })) fd.append(k, v);
    const r = await fetch(`${srv.url}/ead/curso-online/novo`, { method: 'POST', redirect: 'manual', body: fd });
    assert.equal(r.status, 302);
    const co = await prisma.cursoOnline.findFirst({ where: { curso: { nome: dados.nome } }, include: { curso: { include: { faqs: { orderBy: { ordem: 'asc' } } } } } });
    cos.push(co.id);
    assert.deepEqual(co.curso.faqs.map((f) => f.pergunta), ['Quem pode fazer?', 'Tem certificado?']);
    const fd2 = new FormData();
    for (const [k, v] of Object.entries({ _csrf: 'x', nome: dados.nome, cargaHoraria: '3', descricao: 'd', 'faqsIa[0][usar]': '1', 'faqsIa[0][pergunta]': 'Precisa de experiência?', 'faqsIa[0][resposta]': 'Não.' })) fd2.append(k, v);
    assert.equal((await fetch(`${srv.url}/ead/curso/${co.id}/dados`, { method: 'POST', redirect: 'manual', body: fd2 })).status, 302);
    assert.equal(await prisma.faqCurso.count({ where: { cursoId: co.cursoId } }), 3);
  });

  test('formulário tem o bloco da IA (sem script inline) e o "Dados do curso" gera a imagem em segundo plano', async () => {
    const co = await prisma.cursoOnline.findUnique({ where: { id: cos[0] } });
    const html = await get(`/ead/curso/${co.id}/dados`);
    assert.match(html, /data-ia-textos-url="\/ead\/ia-textos"/);
    assert.match(html, /<script[^>]+src="[^"]*ia-textos[^"]*\.js/);
    assert.doesNotMatch(html.slice(html.indexOf('<main') > 0 ? html.indexOf('<main') : 0), /<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
    assert.match(html, /Gerar imagem com IA/);
    const r = await post(`/ead/curso/${co.id}/imagem-curso-ia`);
    assert.equal(r.status, 302);
    await img.ocioso();
    const c = await prisma.curso.findUnique({ where: { id: co.cursoId } });
    assert.match(c.imagemUrl, /\.webp$/);
    assert.equal(c.imagemGeradaPorIa, true);
    assert.match(await get(`/ead/curso/${co.id}/dados`), /Imagem do curso gerada\./);
  });
});
