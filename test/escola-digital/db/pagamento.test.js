// Teste do pagamento da Escola Digital (Task 7): cobrar(), aplicarStatusOnline(), acharPorAviso(),
// reconciliarOnline() direto no banco; o aviso da Únicopag (routes/webhook.js) num app Express de
// verdade; e as telas /digital/pagamento e /digital/simulado com o servidor de verdade.
// Só roda contra banco local (localhost / 127.0.0.1):
//   DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
// Nunca fala com a Únicopag: as funções de lib/unicopag.js usadas aqui são trocadas por falsas
// antes de cada uso, e o servidor de teste sobe sem as chaves.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { ehBancoLocal } = require('../../../src/lib/escola-digital/conteudo');
const { iniciarServidor } = require('../ajuda/servidor');

// Nada de e-mail de verdade nem de cobrança de verdade.
delete process.env.RESEND_API_KEY;
const CHAVES_UNICOPAG = ['UNICOPAG_API_TOKEN', 'UNICOPAG_API_TOKEN_2', 'SELLER_DOCUMENT', 'SELLER_DOCUMENT_2'];
for (const k of CHAVES_UNICOPAG) delete process.env[k];

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

const DOMINIO = 'pagamento-teste.invalid';
const EXEC = `${process.pid}${Date.now() % 100000}`;

let prisma;
let pagamento;   // lib/escola-digital/pagamento.js
let email;       // lib/email.js (o envio é espionado trocando a função exportada)
let unicopag;    // lib/unicopag.js (as chamadas são trocadas por falsas)
let reconciliacao;
let curso;       // curso online do teste (inativo: não aparece na vitrine)
let cursoPresencial;
let matricular;

// E-mails "enviados" pelo pagamento online durante o teste.
let enviados = [];
const originais = {};

let seq = 0;
const proximo = () => { seq += 1; return seq; };

function cpfValido() {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (new Set(d).size === 1) continue;
    for (let n = 9; n <= 10; n++) {
      const soma = d.reduce((s, x, i) => s + x * (n + 1 - i), 0);
      const r = (soma * 10) % 11;
      d.push(r === 10 ? 0 : r);
    }
    return d.join('');
  }
}

async function novoAluno() {
  const n = proximo();
  return prisma.usuario.create({ data: { nome: `Aluna Pagamento ${n}`, email: `p${EXEC}x${n}@${DOMINIO}`, papel: 'ALUNO' } });
}

async function novaInscricao(extra = {}) {
  const aluno = await novoAluno();
  const inscricao = await prisma.inscricaoOnline.create({ data: { alunoId: aluno.id, cursoId: curso.id, ...extra } });
  return { aluno, inscricao };
}

async function novoPagamento(inscricaoId, extra = {}) {
  return prisma.pagamentoOnline.create({
    data: { inscricaoId, metodo: 'PIX', parcelas: 1, valor: 89.9, status: 'PENDENTE', gateway: 'unicopag', ...extra },
  });
}

const lerInscricao = (id) => prisma.inscricaoOnline.findUnique({ where: { id } });
const lerPagamento = (id) => prisma.pagamentoOnline.findUnique({ where: { id } });

before(async () => {
  if (!local) return;
  prisma = require('../../../src/db');
  email = require('../../../src/lib/email');
  unicopag = require('../../../src/lib/unicopag');
  reconciliacao = require('../../../src/lib/reconciliacao');
  pagamento = require('../../../src/lib/escola-digital/pagamento');
  ({ matricular } = require('../../../src/lib/escola-digital/inscricao'));
  for (const k of ['criarTransacao', 'consultarTransacao', 'consultarParcelamento', 'obterOpcaoParcelamento']) originais[k] = unicopag[k];
  originais.enviarMatriculaOnlineConfirmada = email.enviarMatriculaOnlineConfirmada;
  originais.reconciliarOnline = pagamento.reconciliarOnline;

  curso = await prisma.curso.create({
    data: {
      nome: `Curso Online Pagamento ${EXEC}`, cargaHoraria: 4, precoAvista: 89.9, precoCheio: 99.9, parcelas: 3,
      valorParcela: 33.3, ativo: false, modalidade: 'ONLINE', prazoAcessoDias: 30, validadeCertificadoMeses: 24,
    },
  });
  cursoPresencial = await prisma.curso.create({
    data: { nome: `Curso Presencial Pagamento ${EXEC}`, cargaHoraria: 8, precoAvista: 89.9, precoCheio: 99.9, parcelas: 2, valorParcela: 50, ativo: false },
  });
});

beforeEach(() => {
  if (!local) return;
  enviados = [];
  // Espião do e-mail: guarda a chamada em vez de enviar.
  email.enviarMatriculaOnlineConfirmada = async (...args) => { enviados.push(args); };
  // Qualquer chamada à Únicopag que um teste não trocou de propósito falha alto.
  for (const k of ['criarTransacao', 'consultarTransacao', 'consultarParcelamento', 'obterOpcaoParcelamento']) {
    unicopag[k] = async () => { throw new Error(`teste chamou unicopag.${k} sem trocar`); };
  }
  for (const k of CHAVES_UNICOPAG) delete process.env[k];
  process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO = '1';
  pagamento.reconciliarOnline = originais.reconciliarOnline;
});

after(async () => {
  if (!prisma) return;
  for (const k of Object.keys(originais)) {
    if (k === 'enviarMatriculaOnlineConfirmada') email[k] = originais[k];
    else if (k === 'reconciliarOnline') pagamento[k] = originais[k];
    else unicopag[k] = originais[k];
  }
  delete process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO;
  const ids = (await prisma.usuario.findMany({ where: { email: { endsWith: `@${DOMINIO}` } }, select: { id: true } })).map((u) => u.id);
  const pagsOnline = await prisma.pagamentoOnline.findMany({ where: { inscricao: { alunoId: { in: ids } } }, select: { id: true } });
  const matriculas = await prisma.matricula.findMany({ where: { alunoId: { in: ids } }, select: { id: true } });
  const pagsPresenciais = await prisma.pagamento.findMany({ where: { matriculaId: { in: matriculas.map((m) => m.id) } }, select: { id: true } });
  await prisma.logAuditoria.deleteMany({ where: { OR: [{ alvoId: { in: [...pagsOnline, ...pagsPresenciais].map((p) => p.id) } }, { atorId: { in: ids } }] } });
  await prisma.pagamentoOnline.deleteMany({ where: { id: { in: pagsOnline.map((p) => p.id) } } });
  await prisma.inscricaoOnline.deleteMany({ where: { alunoId: { in: ids } } });
  await prisma.pagamento.deleteMany({ where: { id: { in: pagsPresenciais.map((p) => p.id) } } });
  await prisma.matricula.deleteMany({ where: { id: { in: matriculas.map((m) => m.id) } } });
  if (cursoPresencial) await prisma.turma.deleteMany({ where: { cursoId: cursoPresencial.id } });
  await prisma.tokenAuth.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.curso.deleteMany({ where: { id: { in: [curso, cursoPresencial].filter(Boolean).map((x) => x.id) } } });
  await prisma.configuracao.deleteMany({ where: { chave: { in: ['reconciliacao-online:rodada', 'reconciliacao-online:ultima'] } } });
  await prisma.$disconnect();
});

// ---------- aplicarStatusOnline ----------

test('(a) "paid" → pagamento PAGO, inscrição ATIVA com acessoAte = ativadaEm + prazoAcessoDias, e um e-mail', { skip }, async () => {
  const { aluno, inscricao } = await novaInscricao();
  const pag = await novoPagamento(inscricao.id, { metodo: 'CREDITO', parcelas: 3, valor: 99.9 });
  const r = await pagamento.aplicarStatusOnline(pag, { status: 'paid', payload: { amount: 9990, amount_total: 10650 }, origem: 'webhook' });
  assert.strictEqual(r.novoStatus, 'PAGO');

  assert.strictEqual((await lerPagamento(pag.id)).status, 'PAGO');
  const i = await lerInscricao(inscricao.id);
  assert.strictEqual(i.situacao, 'ATIVA');
  assert.ok(i.ativadaEm);
  assert.strictEqual(i.acessoAte.getTime() - i.ativadaEm.getTime(), 30 * 86400000);
  assert.strictEqual(i.plano, 'PARCELADO');
  assert.strictEqual(i.forma, 'CREDITO');
  assert.strictEqual(i.parcelas, 3);
  assert.strictEqual(Number(i.valor), 99.9); // o valor cobrado (base), não o amount_total do aviso

  assert.strictEqual(enviados.length, 1);
  const [para, nome, dados] = enviados[0];
  assert.strictEqual(para, aluno.email);
  assert.strictEqual(nome, 'Aluna');
  assert.strictEqual(dados.curso, curso.nome);
  assert.ok(dados.link.endsWith(`/digital/estudo/${inscricao.id}`));

  const log = await prisma.logAuditoria.findFirst({ where: { alvoId: pag.id } });
  assert.ok(log);
  assert.strictEqual(log.atorId, 'SISTEMA');
  assert.strictEqual(log.alvoTipo, 'PagamentoOnline');
  assert.strictEqual(log.detalhe.para, 'PAGO');
  assert.strictEqual(log.detalhe.inscricaoId, inscricao.id);
});

test('(a) à vista no PIX sem prazo no curso: 365 dias, plano A_VISTA, valor do pagamento', { skip }, async () => {
  await prisma.curso.update({ where: { id: curso.id }, data: { prazoAcessoDias: null } });
  try {
    const { inscricao } = await novaInscricao();
    const pag = await novoPagamento(inscricao.id);
    await pagamento.aplicarStatusOnline(pag, { status: 'paid', payload: {}, origem: 'webhook' });
    const i = await lerInscricao(inscricao.id);
    assert.strictEqual(i.acessoAte.getTime() - i.ativadaEm.getTime(), 365 * 86400000);
    assert.strictEqual(i.plano, 'A_VISTA');
    assert.strictEqual(i.forma, 'PIX');
    assert.strictEqual(i.parcelas, 1);
    assert.strictEqual(Number(i.valor), 89.9);
  } finally {
    await prisma.curso.update({ where: { id: curso.id }, data: { prazoAcessoDias: 30 } });
  }
});

test('(b) o mesmo aviso duas vezes (e duas ao mesmo tempo) → um e-mail e ativadaEm inalterada', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const pag = await novoPagamento(inscricao.id);
  await pagamento.aplicarStatusOnline(pag, { status: 'paid', payload: {}, origem: 'webhook' });
  const primeira = await lerInscricao(inscricao.id);
  // Mesmo objeto antigo (status PENDENTE na memória): só a trava do banco segura.
  const r = await pagamento.aplicarStatusOnline(pag, { status: 'paid', payload: {}, origem: 'reconciliacao' });
  assert.ok(r.info);
  const segunda = await lerInscricao(inscricao.id);
  assert.strictEqual(segunda.ativadaEm.getTime(), primeira.ativadaEm.getTime());
  assert.strictEqual(enviados.length, 1);

  // Duas ao mesmo tempo, num pagamento novo.
  enviados = [];
  const outra = await novaInscricao();
  const pag2 = await novoPagamento(outra.inscricao.id);
  await Promise.all([
    pagamento.aplicarStatusOnline(pag2, { status: 'paid', payload: {}, origem: 'webhook' }),
    pagamento.aplicarStatusOnline(pag2, { status: 'paid', payload: {}, origem: 'reconciliacao' }),
  ]);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual((await lerInscricao(outra.inscricao.id)).situacao, 'ATIVA');
  assert.strictEqual(await prisma.logAuditoria.count({ where: { alvoId: pag2.id } }), 1);
});

test('(b) dois pagamentos diferentes aprovados ao mesmo tempo → ativa uma vez, um e-mail', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const p1 = await novoPagamento(inscricao.id);
  const p2 = await novoPagamento(inscricao.id, { metodo: 'CREDITO' });
  await Promise.all([
    pagamento.aplicarStatusOnline(p1, { status: 'paid', payload: {}, origem: 'webhook' }),
    pagamento.aplicarStatusOnline(p2, { status: 'paid', payload: {}, origem: 'webhook' }),
  ]);
  assert.strictEqual((await lerPagamento(p1.id)).status, 'PAGO');
  assert.strictEqual((await lerPagamento(p2.id)).status, 'PAGO');
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
  assert.strictEqual(enviados.length, 1);
});

test('(c) "refunded" depois → CANCELADA; "paid" depois disso → continua CANCELADA, sem e-mail', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const pag = await novoPagamento(inscricao.id);
  await pagamento.aplicarStatusOnline(pag, { status: 'paid', payload: {}, origem: 'webhook' });
  const r = await pagamento.aplicarStatusOnline(await lerPagamento(pag.id), { status: 'refunded', payload: {}, origem: 'webhook' });
  assert.strictEqual(r.novoStatus, 'ESTORNADO');
  assert.strictEqual((await lerPagamento(pag.id)).status, 'ESTORNADO');
  const cancelada = await lerInscricao(inscricao.id);
  assert.strictEqual(cancelada.situacao, 'CANCELADA');
  assert.ok(cancelada.acessoAte.getTime() <= Date.now());

  enviados = [];
  await pagamento.aplicarStatusOnline(await lerPagamento(pag.id), { status: 'paid', payload: {}, origem: 'webhook' });
  const outro = await novoPagamento(inscricao.id, { metodo: 'CREDITO' });
  await pagamento.aplicarStatusOnline(outro, { status: 'paid', payload: {}, origem: 'webhook' });
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'CANCELADA');
  assert.strictEqual(enviados.length, 0);
});

test('(c) estorno de um pagamento em dobro não cancela a inscrição se outro pagamento continua pago', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const p1 = await novoPagamento(inscricao.id);
  const p2 = await novoPagamento(inscricao.id);
  await pagamento.aplicarStatusOnline(p1, { status: 'paid', payload: {}, origem: 'webhook' });
  await pagamento.aplicarStatusOnline(p2, { status: 'paid', payload: {}, origem: 'webhook' });
  await pagamento.aplicarStatusOnline(await lerPagamento(p2.id), { status: 'refunded', payload: {}, origem: 'webhook' });
  assert.strictEqual((await lerPagamento(p2.id)).status, 'ESTORNADO');
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
});

test('(d) "refused" → pagamento CANCELADO, inscrição segue AGUARDANDO_PAGAMENTO, sem e-mail', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const pag = await novoPagamento(inscricao.id);
  const r = await pagamento.aplicarStatusOnline(pag, { status: 'refused', payload: {}, origem: 'webhook' });
  assert.strictEqual(r.novoStatus, 'CANCELADO');
  assert.strictEqual((await lerPagamento(pag.id)).status, 'CANCELADO');
  const i = await lerInscricao(inscricao.id);
  assert.strictEqual(i.situacao, 'AGUARDANDO_PAGAMENTO');
  assert.strictEqual(i.ativadaEm, null);
  assert.strictEqual(enviados.length, 0);
});

test('status pendente só registra a resposta; contestação não muda o status', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const pag = await novoPagamento(inscricao.id);
  const r = await pagamento.aplicarStatusOnline(pag, { status: 'waiting_payment', payload: { x: 1 }, origem: 'webhook' });
  assert.ok(r.info);
  const depois = await lerPagamento(pag.id);
  assert.strictEqual(depois.status, 'PENDENTE');
  assert.strictEqual(depois.gatewayStatus, 'waiting_payment');
  const a = await pagamento.aplicarStatusOnline(pag, { status: 'pre_chargeback', payload: {}, origem: 'webhook' });
  assert.ok(a.info);
  assert.strictEqual((await lerPagamento(pag.id)).status, 'PENDENTE');
});

// ---------- cobrar ----------

test('(e) duas chamadas iguais a cobrar → um PagamentoOnline PENDENTE (em sequência e ao mesmo tempo)', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const a = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  const b = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(b.reaproveitado, true);
  assert.strictEqual(a.gateway, 'simulado');
  assert.strictEqual(Number(a.valor), 89.9);
  assert.ok(a.pixQrCode);

  const outra = await novaInscricao();
  const [x, y] = await Promise.all([
    pagamento.cobrar({ inscricaoId: outra.inscricao.id, plano: 'PARCELADO', parcelas: 3, forma: 'CREDITO' }),
    pagamento.cobrar({ inscricaoId: outra.inscricao.id, plano: 'PARCELADO', parcelas: 3, forma: 'CREDITO' }),
  ]);
  assert.strictEqual(x.id, y.id);
  assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: outra.inscricao.id, status: 'PENDENTE' } }), 1);
  assert.strictEqual(Number(x.valor), 99.9);
  assert.strictEqual(x.parcelas, 3);
  assert.strictEqual(x.metodo, 'CREDITO');

  // Outra forma ou outro número de parcelas é outra cobrança.
  const z = await pagamento.cobrar({ inscricaoId: outra.inscricao.id, plano: 'PARCELADO', parcelas: 2, forma: 'CREDITO' });
  assert.notStrictEqual(z.id, x.id);
});

test('(e) PIX vencido (mais de 30 min) vira CANCELADO e sai um novo', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const velho = await novoPagamento(inscricao.id, { gateway: 'simulado', pixQrCode: 'velho', criadoEm: new Date(Date.now() - 31 * 60000) });
  const novo = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  assert.notStrictEqual(novo.id, velho.id);
  assert.strictEqual((await lerPagamento(velho.id)).status, 'CANCELADO');
  assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: inscricao.id, status: 'PENDENTE' } }), 1);
});

test('cobrar não reaproveita um PENDENTE de outro gateway (simulado x Únicopag)', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const simulado = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  assert.strictEqual(simulado.gateway, 'simulado');

  delete process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO;
  process.env.UNICOPAG_API_TOKEN = 'token-falso-de-teste';
  let chamadas = 0;
  unicopag.criarTransacao = async () => {
    chamadas += 1;
    return { success: true, gateway: 'unicopag', id: 'id-g', hash: `HGW${EXEC}`, gatewayRef: `HGW${EXEC}`, paymentStatus: 'waiting_payment', pixQrCode: '000201GW' };
  };
  const real = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  assert.notStrictEqual(real.id, simulado.id);
  assert.strictEqual(real.gateway, 'unicopag');
  assert.strictEqual(chamadas, 1);

  // E o contrário: com o simulado ligado de novo, o PENDENTE da Únicopag não serve.
  process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO = '1';
  const deNovo = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  assert.strictEqual(deNovo.id, simulado.id);
  assert.strictEqual(deNovo.reaproveitado, true);
});

test('cobrar recusa combinações inválidas e inscrição que não aguarda pagamento', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const casos = [
    { plano: 'PARCELADO', parcelas: 3, forma: 'PIX' },
    { plano: 'PARCELADO', parcelas: 4, forma: 'CREDITO' },
    { plano: 'PARCELADO', parcelas: 1, forma: 'CREDITO' },
    { plano: 'A_VISTA', parcelas: 2, forma: 'CREDITO' },
    { plano: 'A_VISTA', parcelas: 1, forma: 'DEBITO' },
    { plano: 'PRESENCIAL', parcelas: 1, forma: 'PIX' },
  ];
  for (const c of casos) {
    await assert.rejects(pagamento.cobrar({ inscricaoId: inscricao.id, ...c }), (e) => e.codigo === 'invalido', JSON.stringify(c));
  }
  assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: inscricao.id } }), 0);

  const ativa = await novaInscricao({ situacao: 'ATIVA' });
  await assert.rejects(pagamento.cobrar({ inscricaoId: ativa.inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' }), (e) => e.codigo === 'situacao');
  assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: ativa.inscricao.id } }), 0);
});

test('sem simulado e sem chave da Únicopag: cobrar diz indisponível e não cria nada', { skip }, async () => {
  delete process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO;
  const { inscricao } = await novaInscricao();
  assert.strictEqual(pagamento.disponivel(), false);
  await assert.rejects(pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' }), (e) => e.codigo === 'indisponivel');
  assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: inscricao.id } }), 0);
});

test('Únicopag (falsa): PIX vai com "ED-" + id, conta principal, valor à vista; refs e QR gravados', { skip }, async () => {
  delete process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO;
  process.env.UNICOPAG_API_TOKEN = 'token-falso-de-teste';
  const chamadas = [];
  unicopag.criarTransacao = async (args) => {
    chamadas.push(args);
    return { success: true, gateway: 'unicopag', id: 'id-1', hash: `HPIX${EXEC}`, gatewayRef: `HPIX${EXEC}`, paymentStatus: 'waiting_payment', pixQrCode: '000201PIXFALSO', pixUrl: null, pixBase64: null };
  };
  const { inscricao } = await novaInscricao();
  const p = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'PIX' });
  assert.strictEqual(chamadas.length, 1);
  assert.strictEqual(chamadas[0].matriculaId, `ED-${p.id}`);
  assert.ok(!chamadas[0].conta || chamadas[0].conta === 'principal');
  assert.strictEqual(chamadas[0].forma, 'PIX');
  assert.strictEqual(Number(chamadas[0].valorTotal), 89.9);
  assert.strictEqual(chamadas[0].nomeCurso, curso.nome);
  const gravado = await lerPagamento(p.id);
  assert.strictEqual(gravado.gateway, 'unicopag');
  assert.strictEqual(gravado.gatewayRef, `HPIX${EXEC}`);
  assert.strictEqual(gravado.gatewayHash, `HPIX${EXEC}`);
  assert.strictEqual(gravado.pixQrCode, '000201PIXFALSO');
  assert.strictEqual(gravado.status, 'PENDENTE');
});

test('Únicopag (falsa): cartão parcelado manda o valor cheio e as parcelas; aprovado na hora ativa; cartão nunca gravado', { skip }, async () => {
  delete process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO;
  process.env.UNICOPAG_API_TOKEN = 'token-falso-de-teste';
  const chamadas = [];
  unicopag.criarTransacao = async (args) => {
    chamadas.push(args);
    return { success: true, gateway: 'unicopag', id: 'id-2', hash: `HCC${EXEC}`, gatewayRef: `HCC${EXEC}`, paymentStatus: 'paid', installments: 3 };
  };
  const { inscricao } = await novaInscricao();
  const cartao = { numero: '4111111111111111', titular: 'MARIA DA SILVA', mesExpiracao: '12', anoExpiracao: '2031', cvv: '123' };
  const p = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'PARCELADO', parcelas: 3, forma: 'CREDITO', dadosCartao: cartao });
  assert.strictEqual(chamadas[0].matriculaId, `ED-${p.id}`);
  assert.strictEqual(Number(chamadas[0].valorTotal), 99.9);
  assert.strictEqual(chamadas[0].dadosCartao.parcelas, 3);
  assert.strictEqual(chamadas[0].forma, 'CREDITO');
  assert.strictEqual(p.status, 'PAGO');
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
  assert.strictEqual(enviados.length, 1);
  const linha = JSON.stringify(await lerPagamento(p.id));
  assert.ok(!linha.includes('4111111111111111'));
  assert.ok(!/"cvv"/.test(linha));
});

test('Únicopag (falsa): cartão recusado vira CANCELADO com motivo; erro do gateway também', { skip }, async () => {
  delete process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO;
  process.env.UNICOPAG_API_TOKEN = 'token-falso-de-teste';
  const cartao = { numero: '4000000000000002', titular: 'MARIA DA SILVA', mesExpiracao: '12', anoExpiracao: '2031', cvv: '321' };
  unicopag.criarTransacao = async () => ({ success: true, gateway: 'unicopag', id: 'id-3', hash: `HREC${EXEC}`, gatewayRef: `HREC${EXEC}`, paymentStatus: 'refused' });
  const { inscricao } = await novaInscricao();
  const p = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'CREDITO', dadosCartao: cartao });
  assert.strictEqual(p.status, 'CANCELADO');
  assert.ok(p.motivo);
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'AGUARDANDO_PAGAMENTO');

  unicopag.criarTransacao = async () => { throw new Error('Gateway: {"message":"Cartão sem saldo"}'); };
  const q = await pagamento.cobrar({ inscricaoId: inscricao.id, plano: 'A_VISTA', parcelas: 1, forma: 'CREDITO', dadosCartao: cartao });
  assert.strictEqual(q.status, 'CANCELADO');
  assert.match(q.motivo, /Cartão sem saldo/);
  assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: inscricao.id, status: 'PENDENTE' } }), 0);
});

// ---------- acharPorAviso ----------

test('(f) acharPorAviso: por hash, por order_id "ED-", e sem os dois por e-mail + valor + PENDENTE (o mais recente)', { skip }, async () => {
  const { aluno, inscricao } = await novaInscricao();
  const hash = `HF${EXEC}`;
  const comHash = await novoPagamento(inscricao.id, { gatewayHash: hash, status: 'CANCELADO' });
  assert.strictEqual((await pagamento.acharPorAviso({ hash })).id, comHash.id);
  const porRef = await novoPagamento(inscricao.id, { gatewayRef: `R${hash}`, status: 'CANCELADO' });
  assert.strictEqual((await pagamento.acharPorAviso({ hash: `R${hash}` })).id, porRef.id);

  const antigo = await novoPagamento(inscricao.id, { valor: 77.7, criadoEm: new Date(Date.now() - 60000) });
  const recente = await novoPagamento(inscricao.id, { valor: 77.7 });
  assert.strictEqual((await pagamento.acharPorAviso({ hash: 'nao-existe', email: aluno.email.toUpperCase(), valor: 77.7 })).id, recente.id);
  assert.strictEqual((await pagamento.acharPorAviso({ orderId: `ED-${antigo.id}` })).id, antigo.id);
  // Centavos que o double não representa exato (89,90) também casam.
  const quebrado = await novoPagamento(inscricao.id, { valor: 89.9 });
  assert.strictEqual((await pagamento.acharPorAviso({ email: aluno.email, valor: 8990 / 100 })).id, quebrado.id);
  await prisma.pagamentoOnline.update({ where: { id: quebrado.id }, data: { status: 'CANCELADO' } });
  assert.strictEqual(await pagamento.acharPorAviso({ orderId: antigo.id }), null); // sem o prefixo não casa
  assert.strictEqual(await pagamento.acharPorAviso({ email: aluno.email, valor: 12.34 }), null);
  assert.strictEqual(await pagamento.acharPorAviso({ email: `ninguem@${DOMINIO}`, valor: 77.7 }), null);

  // Pagamento já resolvido não casa por e-mail.
  await prisma.pagamentoOnline.updateMany({ where: { id: { in: [antigo.id, recente.id] } }, data: { status: 'CANCELADO' } });
  assert.strictEqual(await pagamento.acharPorAviso({ email: aluno.email, valor: 77.7 }), null);
  assert.strictEqual(await pagamento.acharPorAviso({}), null);
});

test('(f) e-mail + valor não casa cobrança que já tem referência, nem aviso cujo hash já está gravado', { skip }, async () => {
  const { aluno, inscricao } = await novaInscricao();
  const comRef = await novoPagamento(inscricao.id, { valor: 66.6, gatewayRef: `HJA${EXEC}`, gatewayHash: `HJA${EXEC}` });
  assert.strictEqual(await pagamento.acharPorEmailEValor({ hash: `HNOVO2${EXEC}`, email: aluno.email, valor: 66.6 }), null);
  assert.strictEqual(await pagamento.acharPorIdentificador({ hash: `HJA${EXEC}` }).then((p) => p.id), comRef.id);

  const semRef = await novoPagamento(inscricao.id, { valor: 55.5 });
  assert.strictEqual((await pagamento.acharPorEmailEValor({ hash: `HLIVRE${EXEC}`, email: aluno.email, valor: 55.5 })).id, semRef.id);
  // O hash do aviso já é de outra cobrança (aqui, uma online): não casa por e-mail.
  assert.strictEqual(await pagamento.acharPorEmailEValor({ hash: `HJA${EXEC}`, email: aluno.email, valor: 55.5 }), null);
  // Idem quando o hash está num Pagamento presencial.
  const m = await matriculaPresencial(aluno, 10);
  await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: 10, status: 'PAGO', gatewayRef: `HPRES2${EXEC}` } });
  assert.strictEqual(await pagamento.acharPorEmailEValor({ hash: `HPRES2${EXEC}`, email: aluno.email, valor: 55.5 }), null);
});

// ---------- aviso da Únicopag (routes/webhook.js) ----------

async function comWebhook(fn) {
  const app = express();
  app.use(require('../../../src/routes/webhook'));
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/webhook/unicopag`;
  const avisar = async (corpo) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    return { status: r.status, json: await r.json() };
  };
  try { await fn(avisar); } finally { await new Promise((r) => srv.close(r)); }
}

async function matriculaPresencial(aluno, valor) {
  const turma = await prisma.turma.create({ data: { cursoId: cursoPresencial.id } });
  const m = await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: valor, taxaConfirmada: true } });
  return m;
}

test('webhook: o pagamento presencial continua sendo achado primeiro (hash e e-mail); o online só depois', { skip }, async () => {
  const { aluno, inscricao } = await novaInscricao();
  const m = await matriculaPresencial(aluno, 100);
  const hashPres = `HPRES${EXEC}`;
  const pres = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: 100, status: 'PENDENTE', gatewayHash: hashPres, gatewayRef: hashPres } });
  const pres2 = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: 100, status: 'PENDENTE' } });
  const online = await novoPagamento(inscricao.id, { valor: 100 });
  // Valor redondo de propósito: o caminho 3 de hoje filtra a coluna Decimal com um número do JS, e
  // o Prisma 5 não acha valores como 89,90 assim (ver o relatório da Task 7). O teste prende o
  // comportamento atual, sem mexer nele.

  await comWebhook(async (avisar) => {
    // 1) hash do presencial: casa o presencial; o online fica como está.
    let r = await avisar({ hash: hashPres, payment_status: 'paid', amount: 10000, customer: { email: aluno.email } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await prisma.pagamento.findUnique({ where: { id: pres.id } })).status, 'PAGO');
    assert.strictEqual((await lerPagamento(online.id)).status, 'PENDENTE');

    // 2) hash desconhecido, mesmo e-mail e valor: o PENDENTE presencial ganha (caminho 3 de hoje).
    r = await avisar({ hash: `HX1${EXEC}`, payment_status: 'paid', amount: 10000, customer: { email: aluno.email } });
    assert.strictEqual(r.status, 200);
    const p2 = await prisma.pagamento.findUnique({ where: { id: pres2.id } });
    assert.strictEqual(p2.status, 'PAGO');
    assert.strictEqual(p2.gatewayRef, `HX1${EXEC}`);
    assert.strictEqual((await lerPagamento(online.id)).status, 'PENDENTE');
    assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'AGUARDANDO_PAGAMENTO');

    // 3) sem nada presencial pendente: agora casa o online por e-mail + valor, grava o hash e ativa.
    r = await avisar({ hash: `HX2${EXEC}`, payment_status: 'paid', amount: 10000, customer: { email: aluno.email } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true });
    const o = await lerPagamento(online.id);
    assert.strictEqual(o.status, 'PAGO');
    assert.strictEqual(o.gatewayRef, `HX2${EXEC}`);
    assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
    // O webhook roda neste mesmo processo: o espião vê o e-mail da ativação online.
    assert.strictEqual(enviados.length, 1);
  });
});

test('webhook: online por hash e por order_id "ED-"; repetido responde "já processado"; desconhecido segue 404', { skip }, async () => {
  const { inscricao } = await novaInscricao();
  const hash = `HON${EXEC}`;
  const online = await novoPagamento(inscricao.id, { gatewayHash: hash, gatewayRef: hash });
  const outra = await novaInscricao();
  const porPedido = await novoPagamento(outra.inscricao.id, { valor: 55.5 });

  await comWebhook(async (avisar) => {
    let r = await avisar({ hash, payment_status: 'paid', amount: 8990 });
    assert.deepStrictEqual(r, { status: 200, json: { ok: true } });
    assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
    r = await avisar({ hash, payment_status: 'paid', amount: 8990 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.info, 'já processado');

    r = await avisar({ hash: `HNOVO${EXEC}`, payment_status: 'waiting_payment', amount: 5550, metadata: { order_id: `ED-${porPedido.id}` } });
    assert.strictEqual(r.status, 200);
    const p = await lerPagamento(porPedido.id);
    assert.strictEqual(p.gatewayRef, `HNOVO${EXEC}`);
    assert.strictEqual(p.status, 'PENDENTE');

    r = await avisar({ hash: `HNADA${EXEC}`, payment_status: 'paid', amount: 1, customer: { email: `ninguem@${DOMINIO}` } });
    assert.strictEqual(r.status, 404);
  });
  assert.strictEqual(enviados.length, 1);
});

test('webhook: aviso com o hash de uma cobrança online não marca pago o presencial PENDENTE de mesmo e-mail e valor', { skip }, async () => {
  const { aluno, inscricao } = await novaInscricao();
  const m = await matriculaPresencial(aluno, 100);
  const pres = await prisma.pagamento.create({ data: { matriculaId: m.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: 100, status: 'PENDENTE' } });
  const hash = `HONL${EXEC}`;
  const online = await novoPagamento(inscricao.id, { valor: 100, gatewayHash: hash, gatewayRef: hash });
  await comWebhook(async (avisar) => {
    const r = await avisar({ hash, payment_status: 'paid', amount: 10000, customer: { email: aluno.email } });
    assert.deepStrictEqual(r, { status: 200, json: { ok: true } });
  });
  assert.strictEqual((await prisma.pagamento.findUnique({ where: { id: pres.id } })).status, 'PENDENTE');
  assert.strictEqual((await prisma.pagamento.findUnique({ where: { id: pres.id } })).gatewayRef, null);
  assert.strictEqual((await lerPagamento(online.id)).status, 'PAGO');
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
});

test('webhook: aviso presencial que não casa no passo 3 não ativa inscrição online cuja cobrança tem outro hash', { skip }, async () => {
  const { aluno, inscricao } = await novaInscricao();
  const online = await novoPagamento(inscricao.id, { valor: 100, gatewayHash: `HOUTRO${EXEC}`, gatewayRef: `HOUTRO${EXEC}` });
  await comWebhook(async (avisar) => {
    const r = await avisar({ hash: `HPRESX${EXEC}`, payment_status: 'paid', amount: 10000, customer: { email: aluno.email } });
    assert.strictEqual(r.status, 404);
  });
  const depois = await lerPagamento(online.id);
  assert.strictEqual(depois.status, 'PENDENTE');
  assert.strictEqual(depois.gatewayRef, `HOUTRO${EXEC}`);
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'AGUARDANDO_PAGAMENTO');
  assert.strictEqual(enviados.length, 0);
});

// ---------- reconciliação ----------

test('reconciliarOnline sem chave da Únicopag não faz nada (rodando local)', { skip }, async () => {
  const r = await pagamento.reconciliarOnline({ forcar: true });
  assert.ok(r.semChave);
});

test('reconciliarOnline: pergunta à Únicopag pelos pendentes com mais de 10 min e aplica; trava própria entre serviços', { skip }, async () => {
  process.env.UNICOPAG_API_TOKEN = 'token-falso-de-teste';
  const { inscricao } = await novaInscricao();
  const ref = `RREC${EXEC}`;
  const velho = await novoPagamento(inscricao.id, { gatewayRef: ref, criadoEm: new Date(Date.now() - 20 * 60000) });
  const novo = await novoPagamento(inscricao.id, { gatewayRef: `${ref}-novo` });
  const consultados = [];
  unicopag.consultarTransacao = async (r, contaId) => {
    consultados.push([r, contaId]);
    return r.startsWith(ref) ? { status: 'paid', raw: { amount: 8990 } } : null;
  };
  const resumo = await pagamento.reconciliarOnline({ forcar: true });
  assert.ok(resumo.atualizados >= 1);
  assert.ok(consultados.some(([r, c]) => r === ref && (c === 'principal' || c === undefined)));
  assert.ok(!consultados.some(([r]) => r === `${ref}-novo`));
  assert.strictEqual((await lerPagamento(velho.id)).status, 'PAGO');
  assert.strictEqual((await lerPagamento(novo.id)).status, 'PENDENTE');
  assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');

  // Trava: duas passadas seguidas sem forcar → a segunda pula. (Um pendente que a Únicopag
  // falsa não responde continua pendente, para a segunda passada ter o que conferir.)
  await novoPagamento(inscricao.id, { gatewayRef: `SEMRESPOSTA${EXEC}`, criadoEm: new Date(Date.now() - 20 * 60000) });
  await prisma.configuracao.deleteMany({ where: { chave: 'reconciliacao-online:rodada' } });
  const a = await pagamento.reconciliarOnline();
  const b = await pagamento.reconciliarOnline();
  assert.ok(!a.pulada);
  assert.strictEqual(b.pulada, true);
});

test('rodar(): chama o laço online depois do presencial, e um erro nele não derruba a passada', { skip }, async () => {
  let chamou = 0;
  pagamento.reconciliarOnline = async () => { chamou += 1; throw new Error('falha de teste'); };
  await reconciliacao.rodar();
  assert.strictEqual(chamou, 1);
});

// ---------- telas (servidor de verdade) ----------

function cliente(servidor) {
  let cookie = '';
  const guardar = (r) => {
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of sc) { if (c.startsWith('escola.sid=')) cookie = c.split(';')[0]; }
  };
  return {
    async get(caminho) {
      const r = await fetch(servidor.url + caminho, { redirect: 'manual', headers: cookie ? { cookie } : {} });
      guardar(r);
      return r;
    },
    async post(caminho, corpo) {
      const r = await fetch(servidor.url + caminho, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(corpo).toString(),
      });
      guardar(r);
      return r;
    },
  };
}

const lerCsrf = (html) => html.match(/name="_csrf"\s+value="([0-9a-f]+)"/)[1];

// Aluno com senha (matrícula rápida) e login feito de verdade.
async function alunoLogado(servidor) {
  const n = proximo();
  const dados = { nome: 'Maria da Silva', cpf: cpfValido(), celular: '(21) 98888-7777', email: `h${EXEC}x${n}@${DOMINIO}`, aceite: 'on' };
  const r = await matricular({ cursoId: curso.id, dados });
  const c = cliente(servidor);
  const f = await c.get('/login');
  const l = await c.post('/login', { _csrf: lerCsrf(await f.text()), identificador: dados.email, senha: dados.cpf.slice(-4) });
  assert.strictEqual(l.status, 302);
  return { c, inscricao: r.inscricao };
}

test('telas com pagamento simulado: PIX com QR e Aprovar; aprovar ativa; status JSON; dono só', { skip }, async () => {
  const servidor = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1', ESCOLA_DIGITAL_PAGAMENTO_SIMULADO: '1' } });
  try {
    const { c, inscricao } = await alunoLogado(servidor);
    const base = `/digital/pagamento/${inscricao.id}`;

    // Sem login: vai entrar.
    const anon = await fetch(servidor.url + base, { redirect: 'manual' });
    assert.strictEqual(anon.status, 302);
    assert.match(anon.headers.get('location'), /\/login/);

    let r = await c.get(base);
    assert.strictEqual(r.status, 200);
    let html = await r.text();
    assert.ok(html.includes('À vista'));
    assert.ok(html.includes('value="PIX"'));
    assert.ok(html.includes('value="CREDITO"'));
    assert.ok(html.includes('R$ 89,90'));
    assert.ok(/3×/.test(html));
    assert.ok(!/<script>/.test(html)); // sem script embutido (CSP)
    const csrf = lerCsrf(html);

    // Parcelado no PIX: recusado no servidor, nada criado.
    r = await c.post(base, { _csrf: csrf, opcao: 'PARCELADO:3', forma: 'PIX' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: inscricao.id } }), 0);

    r = await c.post(base, { _csrf: csrf, opcao: 'A_VISTA:1', forma: 'PIX' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), base);
    const pag = await prisma.pagamentoOnline.findFirst({ where: { inscricaoId: inscricao.id } });
    assert.strictEqual(pag.gateway, 'simulado');

    r = await c.get(base);
    html = await r.text();
    assert.ok(html.includes('data:image/png;base64,'));
    assert.ok(html.includes(pag.pixQrCode));
    assert.ok(html.includes(`/digital/simulado/${pag.id}`));
    assert.ok(html.includes('/js/escola-digital.js'));

    r = await c.get(`${base}/status`);
    assert.deepStrictEqual(await r.json(), { status: 'PENDENTE', situacao: 'AGUARDANDO_PAGAMENTO' });

    // Outra pessoa logada não vê nada desta inscrição.
    const outro = await alunoLogado(servidor);
    assert.strictEqual((await outro.c.get(base)).status, 404);
    assert.strictEqual((await outro.c.get(`${base}/status`)).status, 404);
    assert.strictEqual((await outro.c.get(`/digital/simulado/${pag.id}`)).status, 404);

    r = await c.get(`/digital/simulado/${pag.id}`);
    assert.strictEqual(r.status, 200);
    html = await r.text();
    assert.ok(html.includes('Aprovar'));
    assert.ok(html.includes('Recusar'));
    r = await c.post(`/digital/simulado/${pag.id}`, { _csrf: lerCsrf(html), acao: 'aprovar' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), `/digital/estudo/${inscricao.id}/continuar`);
    assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');

    r = await c.get(`${base}/status`);
    assert.deepStrictEqual(await r.json(), { status: 'PAGO', situacao: 'ATIVA' });

    // Cobrança já respondida: o banco simulado não mexe mais nela.
    html = await (await c.get(`/digital/simulado/${pag.id}`)).text();
    assert.ok(html.includes('Cobrança já respondida'));
    assert.ok(!html.includes('value="recusar"'));
    r = await c.post(`/digital/simulado/${pag.id}`, { _csrf: lerCsrf(await (await c.get('/minha-conta')).text()), acao: 'recusar' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), base);
    assert.strictEqual((await lerPagamento(pag.id)).status, 'PAGO');
    assert.strictEqual((await lerInscricao(inscricao.id)).situacao, 'ATIVA');
    r = await c.get(base);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), `/digital/estudo/${inscricao.id}`);

    // Cartão (simulado) recusado: volta para a escolha com o motivo e a opção do PIX.
    const outra = await alunoLogado(servidor);
    const base2 = `/digital/pagamento/${outra.inscricao.id}`;
    const csrf2 = lerCsrf(await (await outra.c.get(base2)).text());
    r = await outra.c.post(base2, { _csrf: csrf2, opcao: 'PARCELADO:3', forma: 'CREDITO', numero: '4111 1111 1111 1111', titular: 'MARIA DA SILVA', validade: '12/31', cvv: '123' });
    assert.strictEqual(r.status, 302);
    const pagCartao = await prisma.pagamentoOnline.findFirst({ where: { inscricaoId: outra.inscricao.id } });
    assert.strictEqual(pagCartao.metodo, 'CREDITO');
    assert.strictEqual(pagCartao.parcelas, 3);
    assert.ok(!JSON.stringify(pagCartao).includes('4111'));
    html = await (await outra.c.get(base2)).text();
    assert.ok(html.includes(`/digital/simulado/${pagCartao.id}`));
    const s = await outra.c.get(`/digital/simulado/${pagCartao.id}`);
    r = await outra.c.post(`/digital/simulado/${pagCartao.id}`, { _csrf: lerCsrf(await s.text()), acao: 'recusar' });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), `${base2}?recusado=1`);
    html = await (await outra.c.get(`${base2}?recusado=1`)).text();
    assert.ok(/recusad/i.test(html));
    assert.ok(html.includes('value="PIX"'));
    assert.strictEqual((await lerInscricao(outra.inscricao.id)).situacao, 'AGUARDANDO_PAGAMENTO');
  } finally {
    await servidor.parar();
  }
});

test('sem a chave do simulado: /digital/simulado 404 e, sem Únicopag, "Pagamento indisponível no momento"', { skip }, async () => {
  const servidor = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1' } });
  try {
    const { c, inscricao } = await alunoLogado(servidor);
    assert.strictEqual((await c.get('/digital/simulado/x')).status, 404);
    const r = await c.get(`/digital/pagamento/${inscricao.id}`);
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('Pagamento indisponível no momento'));
    // A tela não tem formulário; o token da sessão sai de Minha conta.
    const csrf = lerCsrf(await (await c.get('/minha-conta')).text());
    const p = await c.post(`/digital/pagamento/${inscricao.id}`, { _csrf: csrf, opcao: 'A_VISTA:1', forma: 'PIX' });
    assert.strictEqual(p.status, 503);
    assert.strictEqual(await prisma.pagamentoOnline.count({ where: { inscricaoId: inscricao.id } }), 0);
  } finally {
    await servidor.parar();
  }
});
