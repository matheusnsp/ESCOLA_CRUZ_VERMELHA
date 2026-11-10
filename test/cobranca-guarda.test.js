// lib/cobranca-guarda.js: proteção contra rajadas de cobrança no site do aluno (caso real de 06/08/2026:
// ~50 Pagamento CANCELADO da mesma matrícula em rajada, com o gateway fora do ar). Postgres LOCAL;
// gateway falso; a sessão vem do cabeçalho x-teste-usuario (só neste app de teste).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); } return d.join(''); };

describe('proteção contra rajadas de cobrança', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const unicopag = require('../src/lib/unicopag');
  const guarda = require('../src/lib/cobranca-guarda');
  const s = String(Date.now()).slice(-7);
  const gateway = []; const usuarios = []; const matriculas = [];
  let server; let site; let curso; let turma; let modoAntes;
  const orig = unicopag.criarTransacao;
  let modoGateway = 'ok'; // 'ok' responde na hora; 'lento' demora 300 ms (os pedidos simultâneos se sobrepõem de verdade)

  const novoAluno = async (n) => { const u = await prisma.usuario.create({ data: { nome: 'Aluno Rajada ' + n, email: `aluno-rajada-${n}-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf(), tipoDocumento: 'CPF', cep: '20000000', logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Rio', uf: 'RJ', celular: '21987654321' } }); usuarios.push(u.id); return u; };
  // Matrícula PARCELADO sem a taxa confirmada: é o que POST /pagar-taxa cobra.
  const novaMatricula = async (n) => {
    const u = await novoAluno(n);
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'PARCELADO', forma: 'PIX', valorCurso: 500, valorTaxaMatricula: 50, statusPagamento: 'PENDENTE' } });
    matriculas.push(m.id);
    return { u, m };
  };
  const pagamentos = (m) => prisma.pagamento.findMany({ where: { matriculaId: m.id }, orderBy: { criadoEm: 'asc' } });
  const logsDe = (m) => prisma.logAuditoria.findMany({ where: { acao: 'RAJADA_PAGAMENTO', alvoId: m.id } });
  // CANCELADO sem resposta do gateway: o que o catch das rotas grava quando a Únicopag não responde.
  const semResposta = (m) => prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'TAXA', gateway: 'unicopag', metodo: 'PIX', valor: 50, status: 'CANCELADO' } });

  before(async () => {
    modoAntes = await prisma.configuracao.findUnique({ where: { chave: 'matricula_modo' } });
    await prisma.configuracao.upsert({ where: { chave: 'matricula_modo' }, update: { valor: 'POR_CURSO' }, create: { chave: 'matricula_modo', valor: 'POR_CURSO' } });
    require('../src/lib/matricula').limparCacheConfig();
    unicopag.criarTransacao = async (d) => {
      gateway.push(d);
      if (modoGateway === 'lento') await new Promise((r) => setTimeout(r, 300));
      return { gatewayRef: `rj-falso-${s}-${gateway.length}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR-FALSO' };
    };
    curso = await prisma.curso.create({ data: { nome: `Socorrista rajada ${s}`, cargaHoraria: 8, precoAvista: 500, precoCheio: 600, parcelas: 6, valorParcela: 100, taxaMatricula: 50 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: new Date('2099-03-01T12:00:00Z'), vagas: 50, status: 'ABERTA' } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.set('trust proxy', true); // x-forwarded-for vira req.ip: cada cenário usa um IP
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = require('../src/lib/vitrine').urlCurso;
    app.locals.requisitoCurso = require('../src/lib/vitrine').requisitoCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } Object.assign(res.locals, { csrfToken: 'x', urlSite: 'https://escola.exemplo' }); next(); });
    app.use(require('../src/routes/cursos'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    unicopag.criarTransacao = orig;
    const ms = await prisma.matricula.findMany({ where: { turmaId: turma.id }, select: { id: true } });
    const ids = ms.map((m) => m.id);
    await prisma.logAuditoria.deleteMany({ where: { acao: 'RAJADA_PAGAMENTO', alvoId: { in: ids } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ids } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ids } } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    if (modoAntes) await prisma.configuracao.update({ where: { chave: 'matricula_modo' }, data: { valor: modoAntes.valor } }); else await prisma.configuracao.deleteMany({ where: { chave: 'matricula_modo' } });
    require('../src/lib/matricula').limparCacheConfig();
    await prisma.$disconnect();
  });

  const post = (u, usuario, corpo, ip = '10.9.0.1') => fetch(site + u, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ _csrf: 'x', ...corpo }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-teste-usuario': usuario.id, 'x-forwarded-for': ip },
  });

  // ---------------------------------------------------------------- lib
  test('criarCobrancaTravada: 12 pedidos simultâneos da mesma matrícula viram 1 Pagamento', async () => {
    const { m } = await novaMatricula('trava');
    const args = { matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', gateway: 'unicopag', valor: 50, ip: '10.9.0.1', alunoId: m.alunoId };
    const rs = await Promise.all(Array.from({ length: 12 }, () => guarda.criarCobrancaTravada(args)));
    const criados = rs.filter((r) => r.ok);
    assert.equal(criados.length, 1, 'só um pedido cria');
    assert.ok(rs.filter((r) => !r.ok).every((r) => r.motivo === 'andamento' && r.pagamento && r.pagamento.id === criados[0].pagamento.id), 'os outros apontam para o mesmo Pagamento em andamento');
    const ps = await pagamentos(m);
    assert.equal(ps.length, 1); assert.equal(ps[0].status, 'PENDENTE'); assert.equal(Number(ps[0].valor), 50); assert.equal(ps[0].gateway, 'unicopag');
    assert.equal(await prisma.logAuditoria.count({ where: { acao: 'RAJADA_PAGAMENTO', alvoId: m.id } }), 0, 'pedido simultâneo não é rajada');
  });

  test('podeCobrar: 1ª vez libera; PIX com QR recente é reaproveitado (só do mesmo valor); cartão nunca', async () => {
    const { m } = await novaMatricula('reuso');
    assert.deepEqual(await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX' }), { ok: true });
    const p = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'TAXA', gateway: 'unicopag', metodo: 'PIX', valor: 50, status: 'PENDENTE', gatewayRef: 'ref', pixQrCode: 'QR' } });
    const r = await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX' });
    assert.equal(r.ok, true); assert.equal(r.reaproveitar && r.reaproveitar.id, p.id);
    assert.equal((await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', valor: 50 })).reaproveitar.id, p.id);
    assert.equal((await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', valor: 40 })).reaproveitar, undefined, 'QR de outro valor não serve');
    assert.equal((await guarda.podeCobrar({ matriculaId: m.id, tipo: 'CURSO', metodo: 'PIX' })).reaproveitar, undefined, 'outro tipo não serve');
    assert.deepEqual(await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'CREDITO' }), { ok: true });
    // A trava também enxerga esse QR: não cria outro PIX do mesmo valor, mas cria de outro valor.
    const base = { matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', gateway: 'unicopag', alunoId: m.alunoId };
    assert.equal((await guarda.criarCobrancaTravada({ ...base, valor: 50 })).motivo, 'andamento');
    assert.equal((await guarda.criarCobrancaTravada({ ...base, valor: 40 })).ok, true);
  });

  test('limite: a 6ª cobrança em 15 min é recusada e grava UMA RAJADA_PAGAMENTO por janela', async () => {
    const { m } = await novaMatricula('limite');
    for (let i = 0; i < 5; i++) await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'TAXA', gateway: 'unicopag', metodo: 'PIX', valor: 50, status: 'CANCELADO', gatewayRef: 'ref-' + i } });
    const r = await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', ip: '10.9.0.7', alunoId: m.alunoId });
    assert.equal(r.ok, false); assert.equal(r.motivo, 'limite'); assert.equal(r.msg, guarda.MSG_LIMITE);
    assert.match(r.msg, /\(21\) 99992-2864/);
    const r2 = await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', ip: '10.9.0.7', alunoId: m.alunoId });
    assert.equal(r2.motivo, 'limite');
    const logs = await logsDe(m);
    assert.equal(logs.length, 1, 'uma LogAuditoria por janela');
    assert.equal(logs[0].atorId, m.alunoId); assert.equal(logs[0].alvoTipo, 'Matricula');
    assert.deepEqual(logs[0].detalhe, { tentativas: 5, janelaMin: 15, semResposta: 0, ip: '10.9.0.7', motivo: 'limite' });
    // A trava também recusa (mesmo se podeCobrar foi pulado): nada é criado.
    const c = await guarda.criarCobrancaTravada({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', gateway: 'unicopag', valor: 50, alunoId: m.alunoId });
    assert.equal(c.ok, false); assert.equal(c.motivo, 'limite');
    assert.equal(await prisma.pagamento.count({ where: { matriculaId: m.id } }), 5);
  });

  test('disjuntor: 3 cobranças seguidas sem resposta do gateway bloqueiam por 15 min (não para quem não usa o gateway)', async () => {
    const { m } = await novaMatricula('disjuntor');
    await semResposta(m); await semResposta(m);
    assert.deepEqual(await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', alunoId: m.alunoId }), { ok: true }, '2 ainda não abrem o disjuntor');
    await semResposta(m);
    const r = await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', ip: '10.9.0.8', alunoId: m.alunoId });
    assert.equal(r.ok, false); assert.equal(r.motivo, 'gateway'); assert.equal(r.msg, guarda.MSG_GATEWAY);
    const logs = await logsDe(m);
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0].detalhe, { tentativas: 3, janelaMin: 10, semResposta: 3, ip: '10.9.0.8', motivo: 'gateway' });
    assert.deepEqual(await guarda.podeCobrar({ matriculaId: m.id, tipo: 'CURSO', metodo: 'DINHEIRO', gateway: false, alunoId: m.alunoId }), { ok: true }, 'presencial/passaporte não dependem do gateway');
    // Uma cobrança que deu certo no meio zera a conta.
    await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'TAXA', gateway: 'unicopag', metodo: 'PIX', valor: 50, status: 'CANCELADO', gatewayRef: 'respondeu' } });
    assert.deepEqual(await guarda.podeCobrar({ matriculaId: m.id, tipo: 'TAXA', metodo: 'PIX', alunoId: m.alunoId }), { ok: true });
  });

  test('Painel, ficha do aluno e aba Suspeitos leem os RAJADA_PAGAMENTO', async () => {
    const [mLimite, mDisj] = await prisma.matricula.findMany({ where: { turmaId: turma.id, aluno: { nome: { in: ['Aluno Rajada limite', 'Aluno Rajada disjuntor'] } } }, orderBy: { criadoEm: 'asc' }, include: { aluno: true } });
    const dia = await guarda.rajadasDoDia();
    assert.ok(dia.total >= 2);
    const nomes = dia.alunos.map((a) => a.nome);
    assert.ok(nomes.includes('Aluno Rajada limite') && nomes.includes('Aluno Rajada disjuntor'));
    const ficha = await guarda.rajadasDasMatriculas([mLimite.id, mDisj.id]);
    assert.equal(ficha[mLimite.id].length, 1); assert.equal(ficha[mLimite.id][0].tentativas, 5); assert.equal(ficha[mLimite.id][0].janelaMin, 15);
    assert.equal(ficha[mDisj.id][0].tentativas, 3); assert.equal(ficha[mDisj.id][0].janelaMin, 10);
    const lista = await guarda.listarSuspeitos({ dias: 1 });
    const l = lista.find((x) => x.matriculaId === mDisj.id);
    assert.ok(l); assert.equal(l.aluno.email, mDisj.aluno.email); assert.equal(l.aluno.bloqueioTotal, false);
    assert.equal(l.curso, curso.nome); assert.equal(l.semResposta, true); assert.equal(l.ip, '10.9.0.8'); assert.equal(l.tentativas, 3);
    assert.equal(lista.find((x) => x.matriculaId === mLimite.id).semResposta, false);
    assert.ok(lista.findIndex((x) => x.matriculaId === mDisj.id) <= lista.findIndex((x) => x.matriculaId === mLimite.id), 'mais novo primeiro');
  });

  // ---------------------------------------------------------------- rotas
  test('POST /pagar-taxa: 1ª cobrança normal (302 para o QR, 1 Pagamento com a ref); 12 POSTs simultâneos → 1 Pagamento', async () => {
    const { u, m } = await novaMatricula('rota');
    const chamadas = gateway.length;
    const r = await post(`/inscrever/${turma.id}/pagar-taxa`, u, { forma: 'PIX' }, '10.9.1.1');
    assert.equal(r.status, 302); assert.match(r.headers.get('location'), /pix=1&etapa=taxa/);
    let ps = await pagamentos(m);
    assert.equal(ps.length, 1); assert.equal(ps[0].pixQrCode, 'QR-FALSO'); assert.ok(ps[0].gatewayRef); assert.equal(gateway.length, chamadas + 1);
    // QR recente: os 12 reaproveitam, sem ir ao gateway.
    let rs = await Promise.all(Array.from({ length: 12 }, (_, i) => post(`/inscrever/${turma.id}/pagar-taxa`, u, { forma: 'PIX' }, '10.9.1.' + (2 + i))));
    assert.ok(rs.every((x) => x.status === 302 && /pix=1/.test(x.headers.get('location'))));
    assert.equal((await pagamentos(m)).length, 1); assert.equal(gateway.length, chamadas + 1);
    // Matrícula sem nada: 12 simultâneos com o gateway demorando passam pela trava. O primeiro cria e vai
    // ao gateway; os outros esperam o lock, acham o pedido em andamento, esperam o QR dele e caem na mesma
    // tela: 1 Pagamento, 1 ida ao gateway, 12 × 302.
    const { u: u2, m: m2 } = await novaMatricula('rota2');
    modoGateway = 'lento';
    try {
      rs = await Promise.all(Array.from({ length: 12 }, (_, i) => post(`/inscrever/${turma.id}/pagar-taxa`, u2, { forma: 'PIX' }, '10.9.2.' + (1 + i))));
    } finally { modoGateway = 'ok'; }
    ps = await pagamentos(m2);
    assert.equal(ps.length, 1, '12 pedidos simultâneos → 1 Pagamento');
    assert.equal(gateway.length, chamadas + 2, 'uma ida ao gateway');
    assert.ok(rs.every((x) => x.status === 302 && /pix=1&etapa=taxa/.test(x.headers.get('location'))));
  });

  test('POST /pagar-taxa: 6ª cobrança em 15 min → 429 com a mensagem do WhatsApp; gateway sem resposta → 429 "instável"', async () => {
    const { u, m } = await novaMatricula('rota-limite');
    for (let i = 0; i < 5; i++) await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'TAXA', gateway: 'unicopag', metodo: 'PIX', valor: 50, status: 'CANCELADO', gatewayRef: 'ref-' + i } });
    const chamadas = gateway.length;
    const r = await post(`/inscrever/${turma.id}/pagar-taxa`, u, { forma: 'PIX' }, '10.9.3.1');
    assert.equal(r.status, 429);
    const html = await r.text();
    assert.match(html, /Muitas tentativas de pagamento\. Aguarde alguns minutos ou fale com a secretaria pelo WhatsApp \(21\) 99992-2864\./);
    assert.match(html, /<h2>Taxa de inscrição<\/h2>/, 'renderiza a mesma tela da etapa'); assert.match(html, /chk-erro/);
    assert.equal(gateway.length, chamadas); assert.equal((await pagamentos(m)).length, 5);
    assert.equal((await logsDe(m)).length, 1);

    const { u: u2, m: m2 } = await novaMatricula('rota-gateway');
    await semResposta(m2); await semResposta(m2); await semResposta(m2);
    const r2 = await post(`/inscrever/${turma.id}/pagar-taxa`, u2, { forma: 'PIX' }, '10.9.3.2');
    assert.equal(r2.status, 429);
    assert.match(await r2.text(), /O pagamento está instável neste momento\. Tente de novo em alguns minutos\./);
    assert.equal((await pagamentos(m2)).length, 3); assert.equal(gateway.length, chamadas);
    assert.equal((await logsDe(m2)).length, 1);
  });

  test('limite por IP: o 11º pedido de cobrança em 15 min do mesmo IP → 429', async () => {
    const { u } = await novaMatricula('rota-ip');
    const rs = [];
    for (let i = 0; i < 11; i++) rs.push(await post(`/inscrever/${turma.id}/pagar-taxa`, u, { forma: 'PIX' }, '10.9.4.1'));
    assert.ok(rs.slice(0, 10).every((x) => x.status === 302), '10 passam (o QR é reaproveitado)');
    assert.equal(rs[10].status, 429);
    assert.match(await rs[10].text(), /Muitas tentativas de pagamento/);
  });

  test('POST /inscrever (à vista, PIX) passa pela mesma guarda: 12 simultâneos → 1 Pagamento, 1 ida ao gateway', async () => {
    const u = await novoAluno('avista');
    // Matrícula "fantasma" (PENDENTE, sem taxa): o POST a retoma em vez de criar outra, como quando a pessoa
    // volta à tela de pagamento. Assim os 12 pedidos disputam a mesma cobrança, e não a criação da matrícula.
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 550, valorTaxaMatricula: 50, statusPagamento: 'PENDENTE' } });
    const chamadas = gateway.length;
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => post(`/inscrever/${turma.id}`, u, { plano: 'A_VISTA', forma: 'PIX' }, '10.9.5.' + (1 + i))));
    assert.equal((await prisma.matricula.count({ where: { alunoId: u.id } })), 1);
    assert.equal((await pagamentos(m)).length, 1);
    assert.equal(gateway.length, chamadas + 1);
    assert.ok(rs.every((x) => x.status === 302 && /pix=1&etapa=curso/.test(x.headers.get('location'))), 'todos caem na tela do QR');
  });

  test('formulários de pagar: data-cobranca + cobranca-botao.js (sem JS inline), e o JS existe', () => {
    const fs = require('fs');
    const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'inscrever.ejs'), 'utf8');
    assert.equal((view.match(/<form method="POST" action="\/inscrever\/[^"]*" novalidate[^>]* data-cobranca/g) || []).length, 6);
    assert.match(view, /asset\('\/js\/cobranca-botao\.js'\)/);
    const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'cobranca-botao.js'), 'utf8');
    assert.match(js, /Gerando cobrança…/); assert.match(js, /pageshow/);
  });
});
