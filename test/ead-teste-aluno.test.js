// Rotas do aluno no link de teste (quiz, pré-teste, cenário) com sessão de aluno, contra o Postgres LOCAL.
// O app de teste põe o usuário na sessão pelo cabeçalho x-teste-usuario (só aqui, nunca no app real).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const eadTeste = temBanco ? require('../src/lib/ead-teste') : null;

describe('/ead-teste: aluno', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  let server; let base; let curso; let co; let codigo; let m1; let t1; let m2; let t2; let fin; let cen; let ana; let bia;
  const alt = () => ({ create: [{ texto: 'certa', correta: true, ordem: 0 }, { texto: 'errada', correta: false, ordem: 1 }] });

  before(async () => {
    curso = await prisma.curso.create({ data: { nome: 'TESTE rotas aluno', cargaHoraria: 1, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id } });
    m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    t1 = await prisma.topicoEad.create({ data: { moduloId: m1.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M2', ordem: 1 } });
    t2 = await prisma.topicoEad.create({ data: { moduloId: m2.id, titulo: 'T2', telas: { create: [{ titulo: 'tela 2' }] } } });
    for (const t of [t1, t2]) for (let i = 0; i < 8; i++) await prisma.perguntaEad.create({ data: { topicoId: t.id, enunciado: `P${i}`, feedback: 'porque sim', alternativas: alt() } });
    fin = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'F', ordem: 2, final: true } });
    cen = await prisma.cenarioEad.create({ data: { moduloId: fin.id, titulo: 'C', decisoes: { create: [{ pergunta: 'D', opcoes: { create: [0, 1, 2].map((k) => ({ ordem: k, texto: `O${k}`, correta: k === 2, feedback: `fala ${k}` })) } }] } } });
    codigo = await eadTeste.gerarCodigo(co.id);
    ana = await prisma.usuario.create({ data: { nome: 'Ana Rota', email: `ana-rota-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Rota', email: `bia-rota-${Date.now()}@teste.local`, papel: 'ALUNO' } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const u = req.get('x-teste-usuario');
      if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; }
      res.locals.csrfToken = 'x';
      next();
    });
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/ead-teste/${codigo}`;
  });
  after(async () => {
    server.close();
    // certificados emitidos nos testes da etapa 3 (número e Redação ficam no LogAuditoria)
    const acsTeste = await prisma.alunoCursoEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: acsTeste.map((x) => x.id) } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    await eadTeste.desligar(co.id);
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const req = (url, usuario, opts = {}) => fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (url, usuario, corpo = {}) => req(url, usuario, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('quiz sem login: vai para o login (nada é criado)', async () => {
    const r = await post(`${base}/topico/${t1.id}/quiz`, null);
    assert.equal(r.status, 302);
    assert.equal(await prisma.tentativaEad.count({ where: { topicoId: t1.id } }), 0);
  });

  test('quiz de módulo bloqueado: volta ao módulo e não cria tentativa', async () => {
    const r = await post(`${base}/topico/${t2.id}/quiz`, ana);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), new RegExp(`/modulo/${m2.id}$`));
    assert.equal(await prisma.tentativaEad.count({ where: { topicoId: t2.id } }), 0);
  });

  test('tentativa de outra aluna: 404; resposta repetida conta 1 vez', async () => {
    const r = await post(`${base}/topico/${t1.id}/quiz`, ana);
    assert.equal(r.status, 302);
    const url = r.headers.get('location');
    assert.match(url, /\/tentativa\/[0-9a-f-]{36}$/);
    const tid = url.split('/').pop();
    assert.equal((await req(`${base}/tentativa/${tid}`, bia)).status, 404);
    const pag = await (await req(`${base}/tentativa/${tid}`, ana)).text();
    assert.match(pag, /Pergunta 1 de 3/);
    assert.doesNotMatch(pag, /data-correta|correta=|"correta"/); // nada no HTML indica a certa
    const t = await prisma.tentativaEad.findUnique({ where: { id: tid } });
    const certa = await prisma.alternativaEad.findFirst({ where: { perguntaId: t.perguntaIds[0], correta: true } });
    const corpo = { perguntaId: t.perguntaIds[0], alternativa: certa.id };
    const a = await post(`${base}/tentativa/${tid}/responder`, ana, corpo);
    const b = await post(`${base}/tentativa/${tid}/responder`, ana, corpo);
    assert.equal(a.status, 200); // QUIZ: página de retorno
    assert.match(await a.text(), /Correto\./);
    assert.equal(b.status, 302); // repetida: ignorada, volta para a pergunta atual
    const depois = await prisma.tentativaEad.findUnique({ where: { id: tid } });
    assert.equal(depois.acertos, 1); assert.equal(depois.respostas.length, 1);
    assert.equal((await post(`${base}/tentativa/${tid}/responder`, bia, corpo)).status, 404);
  });

  test('pré-teste: uma tentativa só; a segunda volta ao módulo', async () => {
    const r1 = await post(`${base}/modulo/${m1.id}/pre-teste`, bia);
    assert.match(r1.headers.get('location'), /\/tentativa\//);
    const r2 = await post(`${base}/modulo/${m1.id}/pre-teste`, bia);
    assert.match(r2.headers.get('location'), new RegExp(`/modulo/${m1.id}$`));
    assert.equal(await prisma.tentativaEad.count({ where: { moduloId: m1.id, tipo: 'PRE_TESTE' } }), 1);
  });

  test('cenário com o final bloqueado: volta ao módulo; de outro curso: 404', async () => {
    const r = await req(`${base}/cenario/${cen.id}`, ana);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), new RegExp(`/modulo/${fin.id}$`));
    assert.equal((await req(`${base}/cenario/00000000-0000-4000-8000-000000000000`, ana)).status, 404);
  });

  test('cenário liberado: começar, errar (fala do instrutor), acertar e concluir', async () => {
    // libera o final: conclui M1 e M2 da Ana pelo pré-teste aprovado (gravado direto)
    const ac = await prisma.alunoCursoEad.findFirst({ where: { usuarioId: ana.id, cursoOnlineId: co.id } });
    for (const m of [m1, m2]) await prisma.tentativaEad.create({ data: { alunoCursoId: ac.id, tipo: 'PRE_TESTE', moduloId: m.id, perguntaIds: [], total: 8, acertos: 8, aprovado: true, concluidaEm: new Date() } });
    const pag = await req(`${base}/cenario/${cen.id}`, ana);
    assert.equal(pag.status, 200);
    assert.match(await pag.text(), /Começar/);
    assert.equal((await post(`${base}/cenario/${cen.id}/comecar`, ana)).status, 302);
    const andamento = await (await req(`${base}/cenario/${cen.id}`, ana)).text();
    assert.match(andamento, /data-inicio=/);
    assert.doesNotMatch(andamento, /fala 2/); // a fala só aparece depois da escolha
    const d = await prisma.decisaoCenario.findFirst({ where: { cenarioId: cen.id }, include: { opcoes: { orderBy: { ordem: 'asc' } } } });
    const jog = async () => (andamento.match(/name="jogada" value="([^"]+)"/) || [])[1];
    // "Responder" sem marcar opção (2026-11-09, decisão com bolinhas): volta para a decisão, não conta erro
    assert.equal((await post(`${base}/cenario/${cen.id}/escolher`, ana, { decisaoId: d.id, opcaoId: '', jogada: await jog() })).status, 302);
    const errada = await post(`${base}/cenario/${cen.id}/escolher`, ana, { decisaoId: d.id, opcaoId: d.opcoes[0].id, jogada: await jog() });
    assert.equal(errada.status, 200);
    const htmlErrada = await errada.text();
    assert.match(htmlErrada, /fala 0/); assert.match(htmlErrada, /Tentar de novo/);
    const depoisDoErro = await (await req(`${base}/cenario/${cen.id}`, ana)).text();
    const jogada2 = (depoisDoErro.match(/name="jogada" value="([^"]+)"/) || [])[1];
    const certa = await post(`${base}/cenario/${cen.id}/escolher`, ana, { decisaoId: d.id, opcaoId: d.opcoes[2].id, jogada: jogada2 });
    assert.match(await certa.text(), /fala 2/);
    const feito = await prisma.cenarioFeitoEad.findFirst({ where: { alunoCursoId: ac.id, cenarioId: cen.id } });
    assert.ok(feito.concluidoEm); assert.equal(feito.erros, 1);
    assert.ok((await prisma.alunoCursoEad.findUnique({ where: { id: ac.id } })).concluidoEm, 'curso concluído');
    // repetir a escolha depois de concluído: só volta para a página
    assert.equal((await post(`${base}/cenario/${cen.id}/escolher`, ana, { decisaoId: d.id, opcaoId: d.opcoes[2].id })).status, 302);
  });

  test('[revisão #8] responder sem marcar nada não grava (volta para a pergunta)', async () => {
    const q = await post(`${base}/topico/${t1.id}/quiz`, ana);
    const tid = q.headers.get('location').split('/').pop();
    const t = await prisma.tentativaEad.findUnique({ where: { id: tid } });
    const antes = t.respostas.length;
    const pendente = t.perguntaIds[antes];
    const v = await post(`${base}/tentativa/${tid}/responder`, ana, { perguntaId: pendente });
    assert.equal(v.status, 302);
    assert.equal((await prisma.tentativaEad.findUnique({ where: { id: tid } })).respostas.length, antes);
  });

  test('[revisão #2] cenário com a decisão atual apagada ou sem decisões: sem 500', async () => {
    const ac = await prisma.alunoCursoEad.findFirst({ where: { usuarioId: bia.id, cursoOnlineId: co.id } });
    for (const m of [m1, m2]) {
      if (!(await prisma.tentativaEad.count({ where: { alunoCursoId: ac.id, moduloId: m.id, aprovado: true } }))) {
        await prisma.tentativaEad.create({ data: { alunoCursoId: ac.id, tipo: 'PRE_TESTE', moduloId: m.id, perguntaIds: [], total: 8, acertos: 8, aprovado: true, concluidaEm: new Date() } });
      }
    }
    // decisaoAtual além do fim (a decisão foi apagada depois de o aluno começar)
    await prisma.cenarioFeitoEad.create({ data: { alunoCursoId: ac.id, cenarioId: cen.id, decisaoAtual: 5 } });
    const g = await req(`${base}/cenario/${cen.id}`, bia);
    assert.equal(g.status, 200);
    assert.match(await g.text(), /Cenário concluído/);
    // cenário sem nenhuma decisão
    const vazio = await prisma.cenarioEad.create({ data: { moduloId: fin.id, titulo: 'Vazio', ordem: 9 } });
    assert.equal((await req(`${base}/cenario/${vazio.id}`, bia)).status, 200);
    await post(`${base}/cenario/${vazio.id}/comecar`, bia);
    const g2 = await req(`${base}/cenario/${vazio.id}`, bia);
    assert.equal(g2.status, 200);
    assert.match(await g2.text(), /Em preparação/);
    await prisma.cenarioEad.delete({ where: { id: vazio.id } });
  });

  test('[etapa 3] certificado e cartão: sem login vai ao login; sem concluir volta à capa sem emitir', async () => {
    assert.match((await req(`${base}/certificado`, null)).headers.get('location') || '', /\/login$/);
    assert.match((await req(`${base}/cartao-de-bolso.pdf`, null)).headers.get('location') || '', /\/login$/);
    const caio = await prisma.usuario.create({ data: { nome: 'Caio Rota', email: `caio-rota-${Date.now()}@teste.local`, papel: 'ALUNO' } });
    try {
      for (const u of ['certificado', 'cartao-de-bolso.pdf']) {
        const r = await req(`${base}/${u}`, caio);
        assert.equal(r.status, 302); assert.match(r.headers.get('location'), new RegExp(`/ead-teste/${codigo}$`));
      }
      const ac = await prisma.alunoCursoEad.findFirst({ where: { usuarioId: caio.id } });
      assert.equal(await prisma.logAuditoria.count({ where: { id: `certificado-${ac.id}` } }), 0);
    } finally { await prisma.usuario.delete({ where: { id: caio.id } }); }
  });

  test('[etapa 3] concluído: certificado com selo e Livro; cartão em PDF para baixar', async () => {
    const r = await req(`${base}/certificado`, ana);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /CURSO ONLINE/); assert.match(html, /Ana Rota/); assert.match(html, /Livro/);
    assert.match(html, /Baixar cartão de bolso/);
    const c = await req(`${base}/cartao-de-bolso.pdf`, ana);
    assert.equal(c.status, 200);
    assert.match(c.headers.get('content-type'), /application\/pdf/);
    assert.match(c.headers.get('content-disposition'), /attachment; filename="cartao-de-bolso-/);
    assert.equal(Buffer.from(await c.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });

  test('[revisão etapa 3] certificado emitido continua acessível depois que o conteúdo do curso muda', async () => {
    // um módulo novo com uma tela: pelo conteúdo atual, o curso deixa de estar concluído
    const extra = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'Módulo novo', ordem: 5, topicos: { create: [{ titulo: 'T', telas: { create: [{ titulo: 'Tela nova' }] } }] } } });
    try {
      const r = await req(`${base}/certificado`, ana);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /CURSO ONLINE/);
      assert.equal((await req(`${base}/cartao-de-bolso.pdf`, ana)).status, 200);
      assert.match(await (await req(base, ana)).text(), /Ver meu certificado/);
    } finally { await prisma.moduloEad.delete({ where: { id: extra.id } }); }
  });
});
