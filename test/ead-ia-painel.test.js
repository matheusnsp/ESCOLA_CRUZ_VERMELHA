// Etapa 9: painel da criação de curso com IA (só DEV). Postgres LOCAL; cliente falso fixado na fila (nenhum teste
// chama a API de verdade); o roteador do EAD com requireDev liberado, como em test/ead-lote-painel.test.js.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { roteiroBom, moduloBom, clienteFalso } = require('./helpers/ia-falso');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('Painel → Criar curso com IA', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const fila = require('../src/lib/ead-ia-fila');
  const s = String(Date.now()).slice(-7);
  const quem = `dev-painel-ia-${s}`;
  const chaveAntes = process.env.ANTHROPIC_API_KEY;
  let server; let site; let semDev; let semDevSite; let cursoEx; let coEx;
  let modoFalha = false;
  const rot = roteiroBom(3);
  const cli = clienteFalso([(params) => {
    const pedido = params.messages[0].content.at(-1).text;
    const n = Number((pedido.match(/Escreva agora o módulo (\d+)/) || [])[1]);
    if (!n) return roteiroBom(3);
    if (modoFalha && n === 2) return 'quebrado';
    return moduloBom(rot.modulos[n - 1]);
  }]);

  const montar = (requireDev) => {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: quem }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: quem } }); next(); });
    app.use(require('../src/routes/ead')({ requireDev, auditar: async () => {}, ADMIN_URL: '' }));
    return app;
  };

  before(async () => {
    fila.definirCliente(cli);
    cursoEx = await prisma.curso.create({ data: { nome: `Curso Painel IA ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    coEx = await prisma.cursoOnline.create({ data: { cursoId: cursoEx.id } });
    await new Promise((r) => { server = montar((req, res, next) => next()).listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
    await new Promise((r) => { semDev = montar((req, res) => res.status(404).send('não')).listen(0, r); });
    semDevSite = `http://127.0.0.1:${semDev.address().port}`;
  });
  after(async () => {
    await fila.ocioso();
    fila.definirCliente(null);
    server.close(); semDev.close();
    if (chaveAntes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = chaveAntes;
    const gs = await prisma.geracaoIaEad.findMany({ where: { criadoPor: { startsWith: quem } } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: gs.map((g) => g.id) } } });
    await prisma.geracaoIaEad.deleteMany({ where: { criadoPor: { startsWith: quem } } });
    await prisma.configuracao.deleteMany({ where: { chave: { in: ['ead-ia:teto-mensal-usd'] } } });
    const cos = [coEx.id, ...gs.map((g) => g.cursoOnlineId).filter(Boolean)];
    const cursos = (await prisma.cursoOnline.findMany({ where: { id: { in: cos } }, select: { cursoId: true } })).map((c) => c.cursoId);
    const mods = await prisma.moduloEad.findMany({ where: { cursoOnlineId: { in: cos } }, select: { id: true } });
    await prisma.cenarioEad.deleteMany({ where: { moduloId: { in: mods.map((m) => m.id) } } });
    await prisma.topicoEad.deleteMany({ where: { moduloId: { in: mods.map((m) => m.id) } } });
    await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: { in: cos } } });
    await prisma.cursoOnline.deleteMany({ where: { id: { in: cos } } });
    await prisma.curso.deleteMany({ where: { id: { in: cursos } } });
    await prisma.$disconnect();
  });

  const get = async (url) => (await fetch(`${site}${url}`)).text();
  const post = (url, corpo) => fetch(`${site}${url}`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const enviar = (campos, arquivos = []) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
    for (const a of arquivos) fd.append('material', new Blob([a.conteudo]), a.nome);
    return fetch(`${site}/ead/ia/novo?_csrf=x`, { method: 'POST', redirect: 'manual', body: fd });
  };
  const pedidoNovo = (extra = {}) => ({ destino: 'novo', nome: `Curso Gerado IA ${s}`, descricao: 'Curso de teste gerado pela IA.', cargaHoraria: '6', precoOnline: '59,90', maxParcelas: '3', tema: 'Primeiros socorros na escola', publico: 'professores', nModulos: '3', observacoes: '', texto: 'Ligue 192.', ...extra });
  const docx = { nome: 'apostila.docx', conteudo: fs.readFileSync(path.join(__dirname, 'fixtures', 'material-ia.docx')) };
  const roteiroForm = (r, extra = {}) => {
    const c = {};
    r.modulos.forEach((m, i) => {
      c[`modulos[${i}][titulo]`] = m.titulo; c[`modulos[${i}][minutos]`] = String(m.minutos);
      if (m.final) c[`modulos[${i}][final]`] = '1';
      m.topicos.forEach((t, j) => { c[`modulos[${i}][topicos][${j}]`] = t.titulo; });
      (m.cenarios || []).forEach((t, j) => { c[`modulos[${i}][cenarios][${j}]`] = t.titulo; });
    });
    return { ...c, ...extra };
  };
  const ultimaGeracao = () => prisma.geracaoIaEad.findFirst({ where: { criadoPor: quem }, orderBy: { criadoEm: 'desc' } });

  test('sem a chave da API: a lista avisa e o pedido é recusado', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.match(await get('/ead/ia'), /Configure a chave da API da Anthropic \(ANTHROPIC_API_KEY\) no servidor\./);
    const r = await enviar(pedidoNovo());
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Configure a chave da API da Anthropic/);
    process.env.ANTHROPIC_API_KEY = 'chave-falsa-teste';
  });

  test('pedido inválido: tema curto, 13 módulos, arquivo .exe', async () => {
    assert.match(await (await enviar(pedidoNovo({ tema: 'abc' }))).text(), /Tema: de 5 a 300 caracteres\./);
    assert.match(await (await enviar(pedidoNovo({ nModulos: '13' }))).text(), /Módulos: de 2 a 12\./);
    const r = await enviar(pedidoNovo(), [{ nome: 'virus.exe', conteudo: Buffer.from('MZ') }]);
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Envie só arquivos PDF ou Word \(\.docx\)\./);
    assert.equal(await prisma.geracaoIaEad.count({ where: { criadoPor: quem } }), 0);
  });

  test('fluxo completo: pedido → roteiro editável → confirmar com módulo renomeado → concluída, com o selo', async () => {
    const r = await enviar(pedidoNovo(), [docx]);
    assert.equal(r.status, 302);
    const g = await ultimaGeracao();
    assert.equal(r.headers.get('location'), `/ead/ia/${g.id}`);
    assert.match(g.materialTexto, /cinco golpes/);
    assert.match(g.materialTexto, /Ligue 192/);
    await fila.ocioso();
    const pag = await get(`/ead/ia/${g.id}`);
    assert.match(pag, /name="modulos\[0\]\[titulo\]"/);
    assert.match(pag, /Gerar o curso/);
    assert.match(pag, /src="[^"]*\/js\/ead-ia\.js/);
    const rot2 = roteiroBom(3); rot2.modulos[0].titulo = 'Abertura renomeada';
    const c = await post(`/ead/ia/${g.id}/confirmar`, roteiroForm(rot2));
    assert.equal(c.status, 302);
    await fila.ocioso();
    const d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'CONCLUIDA');
    const fim = await get(`/ead/ia/${g.id}`);
    assert.match(fim, /Concluída/);
    assert.match(fim, new RegExp(`href="/ead/curso/${d.cursoOnlineId}"`));
    assert.match(fim, /US\$\s?\d/);
    const curso = await get(`/ead/curso/${d.cursoOnlineId}`);
    assert.match(curso, /Abertura renomeada/);
    assert.match(curso, /Gerado por IA — revise antes de validar/);
    const estado = await (await fetch(`${site}/ead/ia/${g.id}/estado.json`)).json();
    assert.equal(estado.status, 'CONCLUIDA');
    assert.equal(estado.modulos.length, 3);
    assert.match(await get('/ead/ia'), new RegExp(`Curso Gerado IA ${s}`));
  });

  test('roteiro editado inválido: mensagem e nada muda; módulo com erro: tentar de novo', async () => {
    const r = await enviar(pedidoNovo({ destino: 'existente', cursoOnlineId: coEx.id, nome: '' }));
    assert.equal(r.status, 302);
    await fila.ocioso();
    const g = await ultimaGeracao();
    const ruim = roteiroBom(3); ruim.modulos[0].final = true;
    const c = await post(`/ead/ia/${g.id}/confirmar`, roteiroForm(ruim));
    assert.match(await c.text(), /Só o último módulo pode ser o final\./);
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: g.id } })).status, 'ROTEIRO_PRONTO');
    modoFalha = true;
    await post(`/ead/ia/${g.id}/confirmar`, roteiroForm(roteiroBom(3)));
    await fila.ocioso();
    let d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.deepEqual(d.modulos.map((m) => m.status), ['pronto', 'erro', 'pronto']);
    assert.match(await get(`/ead/ia/${g.id}`), /tentar de novo/i);
    modoFalha = false;
    await post(`/ead/ia/${g.id}/modulo/1/tentar`, {});
    await fila.ocioso();
    d = await prisma.geracaoIaEad.findUnique({ where: { id: g.id } });
    assert.equal(d.status, 'CONCLUIDA');
  });

  test('[Review Focus 4] teto: de 0 a 1000; atingido, recusa outro roteiro e pedido novo; a geração em andamento termina', async () => {
    let r = await post('/ead/ia/teto', { teto: '1001' });
    assert.match(decodeURIComponent(r.headers.get('location')), /erro=Teto: de US\$ 0 a US\$ 1000\./);
    r = await post('/ead/ia/teto', { teto: '10' });
    assert.equal((await prisma.configuracao.findUnique({ where: { chave: 'ead-ia:teto-mensal-usd' } })).valor, '10');
    // uma geração esperando o roteiro e outra já gerando os módulos
    const esperando = await prisma.geracaoIaEad.create({ data: { criadoPor: quem, status: 'ROTEIRO_PRONTO', pedido: { destino: { tipo: 'existente', cursoOnlineId: coEx.id }, tema: 'Tema', nModulos: 3 }, roteiro: roteiroBom(3), custoUsd: 10 } });
    const rodando = await prisma.geracaoIaEad.create({ data: { criadoPor: `${quem}-2`, status: 'MODULOS_GERANDO', pedido: { destino: { tipo: 'existente', cursoOnlineId: coEx.id }, tema: 'Tema', nModulos: 3 }, roteiro: roteiroBom(3), cursoOnlineId: coEx.id, modulos: [0, 1, 2].map((o) => ({ ordem: o, titulo: `M${o}`, status: 'pendente' })) } });
    r = await post(`/ead/ia/${esperando.id}/roteiro-de-novo`, {});
    assert.match(decodeURIComponent(r.headers.get('location')), /erro=O teto de gasto com IA deste mês \(US\$ 10\.00\) foi atingido\./);
    const n = await enviar(pedidoNovo({ nome: `Outro ${s}` }));
    assert.match(await n.text(), /O teto de gasto com IA deste mês \(US\$ 10\.00\) foi atingido\./);
    await post(`/ead/ia/${esperando.id}/cancelar`, {});
    fila.acordar();
    await fila.ocioso();
    assert.equal((await prisma.geracaoIaEad.findUnique({ where: { id: rodando.id } })).status, 'CONCLUIDA');
    await prisma.geracaoIaEad.update({ where: { id: rodando.id }, data: { criadoPor: quem } });
    await prisma.geracaoIaEad.updateMany({ where: { criadoPor: quem }, data: { custoUsd: 0 } });
  });

  test('acompanhamento compara com o estado mostrado ao abrir (não com a primeira consulta)', async () => {
    const g = await prisma.geracaoIaEad.create({ data: { criadoPor: `${quem}-3`, status: 'MODULOS_GERANDO', pedido: { destino: { tipo: 'existente', cursoOnlineId: coEx.id }, tema: 'Tema', nModulos: 2 }, roteiro: roteiroBom(2), cursoOnlineId: coEx.id, modulos: [{ ordem: 0, titulo: 'A', status: 'pronto' }, { ordem: 1, titulo: 'B', status: 'gerando' }] } });
    const html = await get(`/ead/ia/${g.id}`);
    assert.match(html, /data-assinatura="\[&#34;MODULOS_GERANDO&#34;,\[&#34;pronto&#34;,&#34;gerando&#34;\]\]"/);
    const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'ead-ia.js'), 'utf8');
    assert.match(js, /getAttribute\('data-assinatura'\)/);
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { criadoPor: quem, status: 'CANCELADA' } });
  });

  test('[revisão I5] lista, página e estado.json não leem o material (PDFs) do banco', async () => {
    const g = await prisma.geracaoIaEad.create({ data: { criadoPor: `${quem}-5`, status: 'MODULOS_GERANDO', pedido: { destino: { tipo: 'existente', cursoOnlineId: coEx.id }, tema: 'Tema', nModulos: 2 }, roteiro: roteiroBom(2), cursoOnlineId: coEx.id, materialPdfs: [{ nome: 'grande.pdf', base64: 'QUJD' }], modulos: [{ ordem: 0, titulo: 'A', status: 'gerando' }] } });
    const consultas = [];
    const orig = { u: prisma.geracaoIaEad.findUnique, m: prisma.geracaoIaEad.findMany };
    prisma.geracaoIaEad.findUnique = (a) => { consultas.push(a); return orig.u.call(prisma.geracaoIaEad, a); };
    prisma.geracaoIaEad.findMany = (a) => { consultas.push(a); return orig.m.call(prisma.geracaoIaEad, a); };
    try {
      await get('/ead/ia'); await get(`/ead/ia/${g.id}`); await fetch(`${site}/ead/ia/${g.id}/estado.json`);
    } finally {
      prisma.geracaoIaEad.findUnique = orig.u; prisma.geracaoIaEad.findMany = orig.m;
    }
    assert.ok(consultas.length >= 3);
    for (const c of consultas) assert.ok(c.select && !c.select.materialPdfs && !c.select.materialTexto, JSON.stringify(c));
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { criadoPor: quem, status: 'CANCELADA' } });
  });

  test('[revisão I7] editor do roteiro: acrescentar módulo e cenário; o bloco de cenários existe em todo módulo', async () => {
    const g = await prisma.geracaoIaEad.create({ data: { criadoPor: `${quem}-7`, status: 'ROTEIRO_PRONTO', pedido: { destino: { tipo: 'existente', cursoOnlineId: coEx.id }, tema: 'Tema', nModulos: 3 }, roteiro: roteiroBom(3) } });
    const html = await get(`/ead/ia/${g.id}`);
    assert.match(html, /data-mais-modulo/);
    assert.equal((html.match(/data-cenarios /g) || []).length, 4, '3 módulos + o modelo do módulo novo');
    assert.equal((html.match(/data-mais-cenario/g) || []).length, 4);
    assert.match(html, /<template id="iaModeloModulo">/);
    const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'ead-ia.js'), 'utf8');
    for (const k of ['data-mais-modulo', 'data-mais-cenario', 'iaModeloModulo']) assert.ok(js.includes(k), k);
    await prisma.geracaoIaEad.update({ where: { id: g.id }, data: { criadoPor: quem, status: 'CANCELADA' } });
  });

  test('conta não DEV ⇒ 404', async () => {
    assert.equal((await fetch(`${semDevSite}/ead/ia`)).status, 404);
  });
});
