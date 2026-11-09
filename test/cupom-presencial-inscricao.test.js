// Cupom na inscrição do presencial (2026-11-09): tela, gravação e etapas. Postgres LOCAL; gateway falso;
// a sessão vem do cabeçalho x-teste-usuario (só neste app de teste).
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); } return d.join(''); };

describe('cupom na inscrição do presencial', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const unicopag = require('../src/lib/unicopag');
  const { calcularValores } = require('../src/lib/matricula');
  const s = String(Date.now()).slice(-7);
  const gateway = []; const usuarios = []; const cupIds = [];
  let server; let site; let curso; let cursoGratis; let turma; let turmaGratis; let taxaAntes; let modoAntes;
  const orig = unicopag.criarTransacao;
  const novoAluno = async (n, extra = {}) => { const u = await prisma.usuario.create({ data: { nome: 'Aluno Cupom ' + n, email: `aluno-cupom-${n}-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf(), tipoDocumento: 'CPF', cep: '20000000', logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Rio', uf: 'RJ', celular: '21987654321', ...extra } }); usuarios.push(u.id); return u; };

  before(async () => {
    modoAntes = await prisma.configuracao.findUnique({ where: { chave: 'matricula_modo' } });
    taxaAntes = await prisma.configuracao.findUnique({ where: { chave: 'matricula_valor_padrao' } });
    await prisma.configuracao.upsert({ where: { chave: 'matricula_modo' }, update: { valor: 'POR_CURSO' }, create: { chave: 'matricula_modo', valor: 'POR_CURSO' } });
    require('../src/lib/matricula').limparCacheConfig();
    unicopag.criarTransacao = async (d) => { gateway.push(d); return { gatewayRef: `cp-falso-${s}-${gateway.length}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR-FALSO' }; };
    curso = await prisma.curso.create({ data: { nome: `Socorrista cupom ${s}`, cargaHoraria: 8, precoAvista: 500, precoCheio: 600, parcelas: 6, valorParcela: 100, taxaMatricula: 50 } });
    cursoGratis = await prisma.curso.create({ data: { nome: `Sem taxa cupom ${s}`, cargaHoraria: 8, precoAvista: 200, precoCheio: 200, valorParcela: 200, taxaMatricula: 0 } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: new Date('2099-03-01T12:00:00Z'), vagas: 20, status: 'ABERTA' } });
    turmaGratis = await prisma.turma.create({ data: { cursoId: cursoGratis.id, inicioPrevisto: new Date('2099-03-01T12:00:00Z'), vagas: 20, status: 'ABERTA' } });
    for (const [codigo, extra] of [[`VINTE${s}`, { cursoId: curso.id, valor: 20 }], [`TUDO${s}`, { cursoId: cursoGratis.id, valor: 100 }], [`ONLINE${s}`, { valor: 10 }]]) {
      cupIds.push((await prisma.cupomEad.create({ data: { codigo, tipo: 'PERCENTUAL', criadoPor: 'teste', ...extra } })).id);
    }
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = require('../src/lib/vitrine').urlCurso;
    app.locals.requisitoCurso = require('../src/lib/vitrine').requisitoCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } Object.assign(res.locals, { csrfToken: 'x', urlSite: 'https://escola.exemplo' }); next(); });
    app.use(require('../src/routes/cursos'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    unicopag.criarTransacao = orig;
    const ms = await prisma.matricula.findMany({ where: { turmaId: { in: [turma.id, turmaGratis.id] } }, select: { id: true } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    await prisma.cupomEad.deleteMany({ where: { id: { in: cupIds } } });
    await prisma.turma.deleteMany({ where: { id: { in: [turma.id, turmaGratis.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [curso.id, cursoGratis.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    for (const [chave, antes] of [['matricula_modo', modoAntes], ['matricula_valor_padrao', taxaAntes]]) {
      if (antes) await prisma.configuracao.update({ where: { chave }, data: { valor: antes.valor } }); else await prisma.configuracao.deleteMany({ where: { chave } });
    }
    require('../src/lib/matricula').limparCacheConfig();
  });

  const req = (u, usuario, opts = {}) => fetch(site + u, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id } : {}) } });
  const post = (u, usuario, corpo) => req(u, usuario, { method: 'POST', body: new URLSearchParams({ _csrf: 'x', ...corpo }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

  test('tela: campo de cupom; válido risca o curso e recalcula; inválido mostra o motivo', async () => {
    const ana = await novoAluno('ana');
    const semCupom = await (await req(`/inscrever/${turma.id}`, ana)).text();
    assert.match(semCupom, /Tem cupom\?/);
    const com = await (await req(`/inscrever/${turma.id}?cupom=vinte${s}`, ana)).text();
    assert.match(com, new RegExp(`Cupom <b>VINTE${s}</b> aplicado`));
    assert.match(com, /<s>R\$\s500,00<\/s>\s*R\$\s400,00/, 'curso à vista riscado e com desconto');
    assert.match(com, /R\$\s450,00/, 'total à vista = 400 + taxa 50');
    const outro = await (await req(`/inscrever/${turma.id}?cupom=ONLINE${s}`, ana)).text();
    assert.match(outro, /Este cupom não vale para este curso/);
    assert.doesNotMatch(outro, /<s>R\$/);
  });

  test('inscrição à vista PIX com cupom: grava o desconto e cobra o total com desconto', async () => {
    const bia = await novoAluno('bia');
    const r = await post(`/inscrever/${turma.id}`, bia, { plano: 'A_VISTA', forma: 'PIX', cupom: `VINTE${s}` });
    assert.equal(r.status, 302);
    const m = await prisma.matricula.findFirst({ where: { alunoId: bia.id, turmaId: turma.id }, include: { cupomEad: true } });
    assert.equal(Number(m.valorCurso), 450);
    assert.ok(m.cupomEad); assert.equal(Number(m.cupomEad.desconto), 100); assert.equal(Number(m.cupomEad.precoFinal), 400);
    const pg = await prisma.pagamento.findFirst({ where: { matriculaId: m.id } });
    assert.equal(Number(pg.valor), 450);
  });

  test('parcelado com cupom: grava, e as etapas usam o curso com desconto', async () => {
    const cris = await novoAluno('cris');
    const r = await post(`/inscrever/${turma.id}`, cris, { plano: 'PARCELADO', cupom: `VINTE${s}` });
    assert.equal(r.status, 302);
    const m = await prisma.matricula.findFirst({ where: { alunoId: cris.id, turmaId: turma.id } });
    assert.equal(Number(m.valorCurso), 530, 'total = 600 - 20% + 50');
    const v = await calcularValores(curso, 'PARCELADO', cris.id, { matriculaId: m.id });
    assert.equal(Number(v.valorCurso), 480);
  });

  test('cupom inválido no envio: volta com a mensagem, nada é gravado', async () => {
    const duda = await novoAluno('duda');
    const r = await post(`/inscrever/${turma.id}`, duda, { plano: 'A_VISTA', forma: 'PIX', cupom: `ONLINE${s}` });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Este cupom não vale para este curso/);
    assert.equal(await prisma.matricula.count({ where: { alunoId: duda.id } }), 0);
  });

  test('100% num curso sem taxa: inscrição confirmada sem cobrança', async () => {
    const edu = await novoAluno('edu');
    const antes = gateway.length;
    const r = await post(`/inscrever/${turmaGratis.id}`, edu, { plano: 'A_VISTA', forma: 'PIX', cupom: `TUDO${s}` });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /\/minha-conta\?inscrito=1/);
    const m = await prisma.matricula.findFirst({ where: { alunoId: edu.id, turmaId: turmaGratis.id }, include: { pagamentos: true, cupomEad: true } });
    assert.equal(m.statusPagamento, 'PAGO'); assert.equal(m.taxaConfirmada, true);
    assert.equal(m.pagamentos.length, 0); assert.equal(gateway.length, antes);
    assert.ok(m.cupomEad);
  });

  test('passaporte com cupom: matrícula com o total com desconto', async () => {
    const fred = await novoAluno('fred', { cpfCnpj: null, tipoDocumento: 'PASSAPORTE', passaporte: `P${s}` });
    const r = await post(`/inscrever/${turma.id}`, fred, { plano: 'A_VISTA', forma: 'DINHEIRO', cupom: `VINTE${s}`, aceite: 'on', contrato: 'on' });
    assert.equal(r.status, 302, await r.text().then((t) => t.slice(0, 200)));
    const m = await prisma.matricula.findFirst({ where: { alunoId: fred.id, turmaId: turma.id }, include: { cupomEad: true } });
    assert.equal(Number(m.valorCurso), 450); assert.ok(m.cupomEad);
  });
});
