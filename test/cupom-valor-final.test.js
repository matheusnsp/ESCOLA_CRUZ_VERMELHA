// Cupom de valor final (2026-11-17; spec docs/superpowers/specs/2026-11-17-cupom-valor-final-design.md):
// a secretaria digita quanto a pessoa paga (matrícula e taxa), a quantidade renova sozinha e a faixa aparece no site.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cupons = require('../src/lib/ead-cupom');

const UM = '11111111-1111-1111-1111-111111111111';

test('lerDados: valor final só no presencial; taxa opcional; aceita vírgula; renovar pede a quantidade', () => {
  const ok = cupons.lerDados({ codigo: 'nov15', tipo: 'FINAL', valor: '150,00', taxaFinal: '0', alvo: `presencial:${UM}`, limiteUsos: '30', renovar: '1', noSite: '1' });
  assert.equal(ok.erro, undefined);
  assert.equal(ok.dados.tipo, 'FINAL'); assert.equal(ok.dados.valor, 150); assert.equal(ok.dados.taxaFinal, 0);
  assert.equal(ok.dados.renovar, true); assert.equal(ok.dados.noSite, true); assert.equal(ok.dados.limiteUsos, 30);
  const semTaxa = cupons.lerDados({ codigo: 'nov16', tipo: 'FINAL', valor: 'R$ 99,90', taxaFinal: '', alvo: 'presenciais' });
  assert.equal(semTaxa.dados.taxaFinal, null, 'vazio = taxa normal'); assert.equal(semTaxa.dados.valor, 99.9);
  assert.equal(cupons.lerDados({ codigo: 'grat', tipo: 'FINAL', valor: '0', alvo: 'presenciais' }).dados.valor, 0, 'curso de graça vale');
  assert.match(cupons.lerDados({ codigo: 'onl', tipo: 'FINAL', valor: '50', alvo: '' }).erro, /presencial/);
  assert.match(cupons.lerDados({ codigo: 'tud', tipo: 'FINAL', valor: '50', alvo: 'tudo' }).erro, /presencial/);
  assert.match(cupons.lerDados({ codigo: 'ren', tipo: 'FINAL', valor: '50', alvo: 'presenciais', renovar: '1' }).erro, /quantos cupons/i);
  assert.match(cupons.lerDados({ codigo: 'sit', tipo: 'PERCENTUAL', valor: '10', alvo: '', noSite: '1' }).erro, /presencial/, 'no site só o presencial');
  assert.equal(cupons.lerDados({ codigo: 'pct', tipo: 'PERCENTUAL', valor: '10', alvo: '', taxaFinal: '5' }).dados.taxaFinal, null, 'taxa só no valor final');
  assert.equal(cupons.lerDados({ codigo: 'pc2', tipo: 'PERCENTUAL', valor: '10,5', alvo: '' }).dados.valor, 10.5);
});

test('calcularDesconto FINAL: paga o valor digitado; acima do preço, sem desconto', () => {
  assert.deepEqual(cupons.calcularDesconto({ tipo: 'FINAL', valor: 150 }, 250), { precoCheio: 250, desconto: 100, precoFinal: 150 });
  assert.deepEqual(cupons.calcularDesconto({ tipo: 'FINAL', valor: 300 }, 250), { precoCheio: 250, desconto: 0, precoFinal: 250 });
});

test('restamDoCupom: sem limite, com limite e renovando', () => {
  assert.equal(cupons.restamDoCupom({ limiteUsos: null }, 7), null);
  assert.deepEqual(cupons.restamDoCupom({ limiteUsos: 30, renovar: false }, 2), { restam: 28, rodada: 1 });
  assert.deepEqual(cupons.restamDoCupom({ limiteUsos: 30, renovar: false }, 31), { restam: 0, rodada: 1 });
  assert.deepEqual(cupons.restamDoCupom({ limiteUsos: 30, renovar: true }, 30), { restam: 30, rodada: 2 }, 'acabou: renova');
  assert.deepEqual(cupons.restamDoCupom({ limiteUsos: 30, renovar: true }, 62), { restam: 28, rodada: 3 });
});

test('textoFaixa: restam, só restam (até 5), até dd/mm', () => {
  const tf = require('../src/lib/cupom-site').textoFaixa;
  const textoFaixa = (x) => tf(x).replace(/\u00a0/g, ' '); // "R$ 150" vem com espaço sem quebra
  assert.equal(textoFaixa({ codigo: 'NOV15', total: 150, restam: 28 }), 'Com o cupom NOV15: R$ 150 com tudo incluso · restam 28 cupons');
  assert.equal(textoFaixa({ codigo: 'X', total: 169.5, restam: 5 }), 'Com o cupom X: R$ 169,50 com tudo incluso · só restam 5 cupons');
  assert.equal(textoFaixa({ codigo: 'X', total: 100, restam: 1 }), 'Com o cupom X: R$ 100 com tudo incluso · só resta 1 cupom');
  assert.equal(textoFaixa({ codigo: 'D', total: 400, restam: null, validoAte: new Date('2026-11-30T12:00:00Z') }), 'Com o cupom D: R$ 400 com tudo incluso · até 30/11');
  assert.equal(textoFaixa({ codigo: 'D', total: 0, restam: null }), 'Com o cupom D: grátis, com tudo incluso');
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); } return d.join(''); };

describe('cupom de valor final no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const unicopag = require('../src/lib/unicopag');
  const { calcularValores, limparCacheConfig } = require('../src/lib/matricula');
  const s = String(Date.now()).slice(-7);
  const usuarios = []; const cupIds = [];
  let server; let site; let curso; let outro; let turma; let turmaOutro; let modoAntes;
  const orig = unicopag.criarTransacao;
  const cupom = async (codigo, extra) => { const c = await prisma.cupomEad.create({ data: { codigo: codigo + s, tipo: 'FINAL', valor: 150, criadoPor: 'teste', ...extra } }); cupIds.push(c.id); return c; };
  const novoAluno = async (n) => { const u = await prisma.usuario.create({ data: { nome: 'Aluno Final ' + n, email: `aluno-final-${n}-${s}@teste.local`, papel: 'ALUNO', cpfCnpj: cpf(), tipoDocumento: 'CPF', cep: '20000000', logradouro: 'Rua', numero: '1', bairro: 'Centro', cidade: 'Rio', uf: 'RJ', celular: '21987654321' } }); usuarios.push(u.id); return u; };
  // Uma inscrição paga com o cupom (conta como 1 uso).
  const usar = async (c, n) => {
    const u = await novoAluno('uso' + n + c.codigo);
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 150, statusPagamento: 'PAGO' } });
    await prisma.cupomMatriculaEad.create({ data: { matriculaId: m.id, cupomId: c.id, precoCheio: 250, desconto: 100, precoFinal: 150 } });
  };

  before(async () => {
    modoAntes = await prisma.configuracao.findUnique({ where: { chave: 'matricula_modo' } });
    await prisma.configuracao.upsert({ where: { chave: 'matricula_modo' }, update: { valor: 'POR_CURSO' }, create: { chave: 'matricula_modo', valor: 'POR_CURSO' } });
    limparCacheConfig();
    unicopag.criarTransacao = async () => ({ gatewayRef: `vf-falso-${s}-${Math.random()}`, hash: 'h', paymentStatus: 'waiting_payment', pixQrCode: 'QR' });
    curso = await prisma.curso.create({ data: { nome: `Cuidador final ${s}`, cargaHoraria: 8, precoAvista: 250, precoCheio: 300, parcelas: 3, valorParcela: 100, taxaMatricula: 99, ativo: true } });
    outro = await prisma.curso.create({ data: { nome: `Socorrista final ${s}`, cargaHoraria: 8, precoAvista: 180, precoCheio: 180, valorParcela: 180, taxaMatricula: 99, ativo: true } });
    turma = await prisma.turma.create({ data: { cursoId: curso.id, inicioPrevisto: new Date(Date.now() + 2 * 864e5), vagas: 200, status: 'ABERTA' } });
    turmaOutro = await prisma.turma.create({ data: { cursoId: outro.id, inicioPrevisto: new Date(Date.now() + 3 * 864e5), vagas: 200, status: 'ABERTA' } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = require('../src/lib/vitrine').urlCurso;
    app.locals.requisitoCurso = require('../src/lib/vitrine').requisitoCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { const u = req.get('x-teste-usuario'); if (u) { req.session.usuarioId = u; req.session.papel = 'ALUNO'; } Object.assign(res.locals, { csrfToken: 'x', isAdmin: false, urlSite: 'https://escola.exemplo' }); next(); });
    app.use(require('../src/routes/cursos'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    unicopag.criarTransacao = orig;
    const ms = await prisma.matricula.findMany({ where: { turmaId: { in: [turma.id, turmaOutro.id] } }, select: { id: true } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { id: { in: ms.map((m) => m.id) } } });
    await prisma.cupomEad.deleteMany({ where: { id: { in: cupIds } } });
    await prisma.turma.deleteMany({ where: { id: { in: [turma.id, turmaOutro.id] } } });
    await prisma.curso.deleteMany({ where: { id: { in: [curso.id, outro.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    if (modoAntes) await prisma.configuracao.update({ where: { chave: 'matricula_modo' }, data: { valor: modoAntes.valor } });
    limparCacheConfig();
  });

  const req = (u, usuario, opts = {}) => fetch(site + u, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), ...(usuario ? { 'x-teste-usuario': usuario.id, ...(usuario.cookie ? { cookie: usuario.cookie } : {}) } : {}) } });

  test('validarCupom: renovar nunca esgota; sem renovar, esgota', async () => {
    const ren = await cupom('REN', { cursoId: curso.id, limiteUsos: 1, renovar: true });
    const fim = await cupom('FIM', { cursoId: curso.id, limiteUsos: 1 });
    await usar(ren, 1); await usar(fim, 1);
    const v = await cupons.validarCupom('REN' + s, curso, { presencial: true, preco: 250 });
    assert.equal(v.erro, undefined); assert.equal(v.precoFinal, 150);
    assert.equal((await cupons.validarCupom('FIM' + s, curso, { presencial: true, preco: 250 })).erro, cupons.MSG.esgotado);
    await prisma.cupomEad.updateMany({ where: { id: { in: [ren.id, fim.id] } }, data: { ativo: false } });
  });

  test('calcularValores: matrícula e taxa do cupom; isento continua isento; a taxa gravada vale depois', async () => {
    const c = await cupom('CALC', { cursoId: curso.id, taxaFinal: 0, ativo: false });
    const v = await calcularValores(curso, 'A_VISTA', null, { cupom: c });
    assert.equal(Number(v.valorCurso), 150); assert.equal(Number(v.valorTaxaMatricula), 0); assert.equal(Number(v.total), 150);
    assert.equal(Number(v.taxaSemCupom), 99); assert.equal(v.taxaDoCupom, 0);
    const meia = await calcularValores(curso, 'A_VISTA', null, { cupom: { ...c, taxaFinal: 200 } });
    assert.equal(Number(meia.valorTaxaMatricula), 99, 'taxa do cupom maior que a normal: fica a normal');
    const parc = await calcularValores(curso, 'PARCELADO', null, { cupom: c });
    assert.equal(Number(parc.valorCurso), 150, 'no parcelado também paga o valor final');
    const semTaxa = await calcularValores(curso, 'A_VISTA', null, { cupom: { ...c, taxaFinal: null } });
    assert.equal(Number(semTaxa.valorTaxaMatricula), 99, 'sem taxa no cupom: taxa normal');
    // gravada
    const u = await novoAluno('grav');
    const m = await prisma.matricula.create({ data: { alunoId: u.id, turmaId: turma.id, plano: 'PRESENCIAL', forma: 'DINHEIRO', valorCurso: 150, statusPagamento: 'PENDENTE' } });
    await prisma.cupomMatriculaEad.create({ data: { matriculaId: m.id, cupomId: c.id, precoCheio: 250, desconto: 100, precoFinal: 150, taxaFinal: 10 } });
    const g = await calcularValores(curso, 'A_VISTA', u.id, { matriculaId: m.id });
    assert.equal(Number(g.valorCurso), 150); assert.equal(Number(g.valorTaxaMatricula), 10);
  });

  test('alterar cupom usado: a taxa final não muda', async () => {
    const c = await cupom('ALT', { cursoId: curso.id, taxaFinal: 20, ativo: false });
    await usar(c, 1);
    const r = await cupons.alterarCupom(c.id, { codigo: c.codigo, tipo: 'FINAL', valor: '150', taxaFinal: '0', alvo: `presencial:${curso.id}` }, 'teste');
    assert.match(r.erro || '', /já foi usado/);
    const r2 = await cupons.alterarCupom(c.id, { codigo: c.codigo, tipo: 'FINAL', valor: '150', taxaFinal: '20', alvo: `presencial:${curso.id}`, limiteUsos: '10', renovar: '1' }, 'teste');
    assert.equal(r2.erro, undefined, 'quantidade e renovar podem mudar');
  });

  test('cuponsDoSite: só os do site, válidos e não esgotados; o mais barato; texto com restam', async () => {
    const { cuponsDoSite } = require('../src/lib/cupom-site');
    await cupom('SITEA', { cursoId: curso.id, noSite: true, limiteUsos: 30, taxaFinal: 0 }); // total 150
    await cupom('SITEB', { cursoId: curso.id, noSite: true, valor: 200 }); // 200 + 99 = 299
    await cupom('ESCOND', { cursoId: curso.id, valor: 10, taxaFinal: 0 }); // fora do site
    await cupom('VENC', { cursoId: curso.id, noSite: true, valor: 10, validoAte: new Date('2020-01-01') });
    const esg = await cupom('ESG', { cursoId: curso.id, noSite: true, valor: 20, limiteUsos: 1 });
    await usar(esg, 1);
    const pct = await cupom('PCT', { tipo: 'PERCENTUAL', valor: 10, todosPresenciais: true, noSite: true, validoAte: new Date('2099-11-30T12:00:00Z') });
    const cfg = { matricula_modo: 'POR_CURSO' };
    const mapa = await cuponsDoSite([curso, outro], cfg);
    const a = mapa.get(curso.id);
    assert.equal(a.codigo, 'SITEA' + s); assert.equal(a.total, 150); assert.equal(a.restam, 30);
    assert.equal(a.texto.replace(/\u00a0/g, ' '), `Com o cupom SITEA${s}: R$ 150 com tudo incluso · restam 30 cupons`);
    const b = mapa.get(outro.id);
    assert.equal(b.codigo, pct.codigo, 'percentual de todos os presenciais também aparece'); assert.equal(b.total, 261);
    assert.match(b.texto, /até 30\/11$/);
  });

  test('site: a faixa aparece no card, em Próximas turmas e nas turmas do curso', async () => {
    const lista = await (await req("/cursos")).text();
    const faixa = new RegExp(`class="v-cupom"[\\s\\S]{0,200}SITEA${s}`);
    assert.match(lista, faixa);
    assert.ok((lista.match(new RegExp(`SITEA${s}`, 'g')) || []).length >= 2, 'no card e em Próximas turmas');
    const home = await (await req('/')).text();
    assert.match(home, faixa);
    const pagina = await (await req(require('../src/lib/vitrine').urlCurso(curso))).text();
    assert.match(pagina, faixa);
  });

  test('inscrição: o cupom do site entra sozinho; tirar fica tirado; o envio grava a taxa do cupom', async () => {
    const ana = await novoAluno('ana');
    const r1 = await req(`/inscrever/${turma.id}`, ana);
    const cookie = (r1.headers.get('set-cookie') || '').split(';')[0];
    const tela = await r1.text();
    assert.match(tela, new RegExp(`Cupom <b>SITEA${s}</b> aplicado`));
    assert.match(tela, /<s>R\$\s99,00<\/s>\s*Grátis/, 'taxa riscada e grátis');
    assert.match(tela, new RegExp(`<input type="hidden" name="cupom" value="SITEA${s}">`));
    const tirou = await (await req(`/inscrever/${turma.id}?cupom=`, { ...ana, cookie })).text();
    assert.doesNotMatch(tirou, /aplicado/);
    const depois = await (await req(`/inscrever/${turma.id}`, { ...ana, cookie })).text();
    assert.doesNotMatch(depois, /aplicado/, 'tirou: não volta sozinho');
    const bia = await novoAluno('bia');
    const r = await req(`/inscrever/${turma.id}`, bia, { method: 'POST', body: new URLSearchParams({ _csrf: 'x', plano: 'A_VISTA', forma: 'PIX', cupom: `SITEA${s}` }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(r.status, 302);
    const m = await prisma.matricula.findFirst({ where: { alunoId: bia.id, turmaId: turma.id }, include: { cupomEad: true } });
    assert.equal(Number(m.valorCurso), 150); assert.equal(Number(m.valorTaxaMatricula), 0);
    assert.equal(Number(m.cupomEad.taxaFinal), 0); assert.equal(Number(m.cupomEad.precoFinal), 150);
  });
});

describe('painel: cupom de valor final', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const s = String(Date.now()).slice(-7);
  let server; let site; let curso;
  before(async () => {
    curso = await prisma.curso.create({ data: { nome: `Painel final ${s}`, cargaHoraria: 8, precoAvista: 250, precoCheio: 250, valorParcela: 250, taxaMatricula: 99 } });
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = { usuarioId: 'dev-final' }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: 'dev' } }); next(); });
    app.use(require('../src/routes/ead')({ requireDev: (q, r, n) => n(), auditar: async () => {}, ADMIN_URL: '' }));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await prisma.cupomEad.deleteMany({ where: { codigo: { startsWith: `PF${s}` } } });
    await prisma.curso.delete({ where: { id: curso.id } });
  });

  test('formulário: tipo valor final, taxa, quantidade que renova e no site; salva e a lista mostra quantos restam', async () => {
    const form = await (await fetch(site + '/ead/cupons/novo')).text();
    assert.match(form, /<option value="FINAL"/);
    assert.match(form, /name="taxaFinal"/);
    assert.match(form, /name="renovar"/);
    assert.match(form, /name="noSite"/);
    const r = await fetch(site + '/ead/cupons/novo', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', codigo: `PF${s}`, tipo: 'FINAL', valor: '0', taxaFinal: '0', alvo: `presencial:${curso.id}`, limiteUsos: '30', renovar: '1', noSite: '1' }) });
    assert.equal(r.status, 302, 'valor final 0 (curso de graça) é aceito');
    const c = await prisma.cupomEad.findUnique({ where: { codigo: `PF${s}` } });
    assert.equal(c.tipo, 'FINAL'); assert.equal(Number(c.valor), 0); assert.equal(Number(c.taxaFinal), 0); assert.equal(c.renovar, true); assert.equal(c.noSite, true);
    const edit = await (await fetch(site + `/ead/cupons/${c.id}`)).text();
    assert.match(edit, /name="renovar"[^>]*checked/); assert.match(edit, /name="noSite"[^>]*checked/);
    assert.match(edit, /name="taxaFinal"[^>]*value="0"/);
    const lista = await (await fetch(site + '/ead/cupons')).text();
    assert.match(lista, /Matrícula R\$\s0,00 · inscrição grátis/);
    assert.match(lista, /restam 30 de 30/);
    assert.match(lista, /renova/);
    assert.match(lista, /no site/);
  });
});
