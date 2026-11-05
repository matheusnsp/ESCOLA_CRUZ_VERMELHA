// Compra e acesso pago do curso online (/online/:cursoId), contra o Postgres LOCAL. Gateway e e-mail
// falsos; a sessão vem do cabeçalho x-teste-usuario (só neste app de teste).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('/online: compra e acesso pago', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const unicopag = require('../src/lib/unicopag');
  const email = require('../src/lib/email');
  const eadTeste = require('../src/lib/ead-teste');
  const { aplicarStatus } = require('../src/lib/status-pagamento');
  const gateway = []; const liberados = [];
  let server; let site; let base; let curso; let co; let m1; let t1; let m2; let ana; let bia; let codigo;
  const alt = () => ({ create: [{ texto: 'certa', correta: true, ordem: 0 }, { texto: 'errada', correta: false, ordem: 1 }] });
  // CPF válido e aleatório (o campo é único no banco de desenvolvimento).
  const cpf = () => {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); }
    return d.join('');
  };

  before(async () => {
    unicopag.criarTransacao = async (d) => { gateway.push(d); return { gatewayRef: `falso-${gateway.length}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR-FALSO' }; };
    email.enviarCursoOnlineLiberado = async (para, nome, dados) => { liberados.push({ para, nome, ...dados }); };
    curso = await prisma.curso.create({ data: { nome: 'TESTE online compra', cargaHoraria: 3, precoAvista: 300, precoCheio: 300, valorParcela: 300 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9 } });
    m1 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0 } });
    t1 = await prisma.topicoEad.create({ data: { moduloId: m1.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }] } } });
    for (let i = 0; i < 3; i++) await prisma.perguntaEad.create({ data: { topicoId: t1.id, enunciado: `P${i}`, feedback: 'f', alternativas: alt() } });
    m2 = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M2', ordem: 1 } });
    await prisma.topicoEad.create({ data: { moduloId: m2.id, titulo: 'T2', telas: { create: [{ titulo: 'tela 2' }] } } });
    ana = await prisma.usuario.create({ data: { nome: 'Ana Online', email: `ana-on-${Date.now()}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });
    bia = await prisma.usuario.create({ data: { nome: 'Bia Online', email: `bia-on-${Date.now()}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf() } });

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
    app.use(require('../src/routes/ead-online'));
    app.use(require('../src/routes/ead-teste'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
    base = `${site}/online/${curso.id}`;
  });
  after(async () => {
    server.close();
    const ms = await prisma.matricula.findMany({ where: { turma: { cursoId: curso.id } }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { turma: { cursoId: curso.id } } });
    await prisma.turma.deleteMany({ where: { cursoId: curso.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [ana.id, bia.id] } } });
    await eadTeste.desligar(co.id);
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const req = (url, usuario, opts = {}) => fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (url, usuario, corpo = {}) => req(url, usuario, { method: 'POST', body: new URLSearchParams(corpo), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const matriculaDe = (u) => prisma.matricula.findFirst({ where: { alunoId: u.id, turma: { cursoId: curso.id } }, include: { pagamentos: { orderBy: { criadoEm: 'asc' } } } });

  test('curso não publicado: visitante e aluna sem matrícula ⇒ 404; comprar ⇒ 404', async () => {
    assert.equal((await req(base, null)).status, 404);
    assert.equal((await req(base, ana)).status, 404);
    assert.equal((await post(`${base}/comprar`, ana, { forma: 'PIX' })).status, 404);
    assert.equal(await matriculaDe(ana), null);
  });

  test('publicado: visitante vê a capa com "Comprar · R$ 49,90" e o aviso da prática', async () => {
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: true } });
    const r = await req(base, null);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Comprar · R\$\s?49,90/);
    assert.match(html, /sem prática em manequim/i);
    assert.doesNotMatch(html, /Versão de teste/);
    // conteúdo pago: módulo e tela sem acesso voltam à capa
    assert.equal((await req(`${base}/modulo/${m1.id}`, null)).headers.get('location'), `/online/${curso.id}`);
  });

  test('comprar por PIX: matrícula à vista sem taxa, Pagamento PENDENTE e retorno com pix=1; de novo ⇒ mesma matrícula', async () => {
    const r = await post(`${base}/comprar`, ana, { forma: 'PIX' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /^\/inscricao\/retorno\?matriculaId=[0-9a-f-]{36}&pix=1&etapa=curso/);
    const m = await matriculaDe(ana);
    assert.equal(m.plano, 'A_VISTA'); assert.equal(m.forma, 'PIX'); assert.equal(Number(m.valorCurso), 49.9);
    assert.equal(Number(m.valorTaxaMatricula), 0); assert.equal(m.taxaConfirmada, true); assert.equal(m.statusPagamento, 'PENDENTE');
    assert.equal(m.pagamentos.length, 1); assert.equal(m.pagamentos[0].status, 'PENDENTE'); assert.equal(Number(m.pagamentos[0].valor), 49.9);
    assert.equal(gateway[0].valorTotal, 49.9);
    const t = await prisma.turma.findUnique({ where: { id: m.turmaId } });
    assert.equal(t.status, 'ONLINE');
    const r2 = await post(`${base}/comprar`, ana, { forma: 'PIX' });
    assert.equal(r2.status, 302);
    assert.equal(await prisma.matricula.count({ where: { alunoId: ana.id, turma: { cursoId: curso.id } } }), 1);
    assert.equal((await matriculaDe(ana)).id, m.id);
    // com a matrícula pendente: "Pagamento em andamento", sem progresso
    const capa = await (await req(base, ana)).text();
    assert.match(capa, /Pagamento em andamento/);
    assert.equal(await prisma.alunoCursoEad.count({ where: { usuarioId: ana.id, cursoOnlineId: co.id } }), 0);
  });

  test('pago (como o webhook): matrícula PAGO, 1 e-mail "liberado" e /continuar abre a tela', async () => {
    const m = await matriculaDe(ana);
    await aplicarStatus(m.pagamentos[0], { status: 'paid', payload: {} });
    const depois = await matriculaDe(ana);
    assert.equal(depois.statusPagamento, 'PAGO'); assert.ok(depois.confirmadaEm);
    assert.equal(liberados.length, 1);
    assert.equal(liberados[0].para, ana.email);
    assert.match(liberados[0].link, new RegExp(`/online/${curso.id}$`));
    const r = await req(`${base}/continuar`, ana);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), new RegExp(`^/online/${curso.id}/tela/`));
    // curso despublicado: quem pagou continua entrando
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: false } });
    assert.equal((await req(base, ana)).status, 200);
    assert.equal((await req(base, bia)).status, 404);
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: true } });
  });

  test('cancelada: capa com "Sua inscrição foi cancelada"; quiz volta à capa sem gravar', async () => {
    const m = await matriculaDe(ana);
    await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'CANCELADO' } });
    const capa = await (await req(base, ana)).text();
    assert.match(capa, /Sua inscrição foi cancelada/);
    const antes = await prisma.tentativaEad.count({ where: { topicoId: t1.id } });
    const q = await post(`${base}/topico/${t1.id}/quiz`, ana);
    assert.equal(q.status, 302); assert.equal(q.headers.get('location'), `/online/${curso.id}`);
    assert.equal(await prisma.tentativaEad.count({ where: { topicoId: t1.id } }), antes);
    assert.equal((await req(`${base}/certificado`, ana)).headers.get('location'), `/online/${curso.id}`);
  });

  test('compra depois do estorno: mesma matrícula volta a PENDENTE, Pagamento novo e os antigos ficam', async () => {
    const m = await matriculaDe(ana);
    await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'ESTORNADO', taxaConfirmada: false } });
    const r = await post(`${base}/comprar`, ana, { forma: 'PIX' });
    assert.match(r.headers.get('location'), /pix=1/);
    const d = await matriculaDe(ana);
    assert.equal(d.id, m.id); assert.equal(d.statusPagamento, 'PENDENTE'); assert.equal(d.taxaConfirmada, true); assert.equal(d.confirmadaEm, null);
    assert.equal(d.pagamentos.length, 2); assert.equal(d.pagamentos[0].status, 'PAGO'); assert.equal(d.pagamentos[1].status, 'PENDENTE');
  });

  test('7 dias contam do pagamento: confirmada há 8 dias ⇒ ordem livre; hoje ⇒ em sequência', async () => {
    const m = await matriculaDe(ana);
    await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'PAGO', confirmadaEm: new Date(Date.now() - 8 * 864e5) } });
    const livre = await (await req(base, ana)).text();
    assert.match(livre, /na ordem que você quiser/);
    assert.ok(await prisma.alunoCursoEad.findFirst({ where: { usuarioId: ana.id, cursoOnlineId: co.id } }), 'iniciadoEm de hoje existe');
    await prisma.matricula.update({ where: { id: m.id }, data: { confirmadaEm: new Date() } });
    assert.match(await (await req(base, ana)).text(), /abrem em sequência/);
  });

  test('link de teste continua sem pagamento', async () => {
    codigo = await eadTeste.gerarCodigo(co.id);
    const r = await req(`${site}/ead-teste/${codigo}/continuar`, bia);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), new RegExp(`^/ead-teste/${codigo}/tela/`));
    assert.match(await (await req(`${site}/ead-teste/${codigo}`, null)).text(), /Versão de teste/);
  });
});

describe('cobrança online: valor do cartão e destino depois de pagar', () => {
  const { cobrancaCartaoOnline, destinoAposPagamento } = require('../src/lib/cobranca-avista');
  test('cartão da turma ONLINE cobra o valor da matrícula, 1x', () => {
    assert.deepEqual(cobrancaCartaoOnline({ valorCurso: '49.90' }), { valorCobranca: 49.9, valorBase: 49.9, numParcelas: 1, valorParcela: null, tipo: 'CURSO' });
  });
  test('destino: online vai para o curso; presencial para a Minha conta', () => {
    assert.equal(destinoAposPagamento({ turma: { status: 'ONLINE', cursoId: 'c1' } }), '/online/c1');
    assert.equal(destinoAposPagamento({ turma: { status: 'ABERTA', cursoId: 'c1' } }), '/minha-conta?inscrito=1');
  });
});
