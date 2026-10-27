const { test } = require('node:test');
const assert = require('node:assert');
const {
  NOTA_MINIMA, PERGUNTAS_TOPICO, PERGUNTAS_PRE_TESTE,
  sortear, aprovado, estadoModulos, proximoPasso, situacaoAtual,
  calcularAcessoAte, calcularValidoAte, efeitoNaInscricao, valorCobranca,
} = require('../../src/lib/escola-digital/regras');

test('constantes', () => {
  assert.equal(NOTA_MINIMA, 0.8);
  assert.equal(PERGUNTAS_TOPICO, 3);
  assert.equal(PERGUNTAS_PRE_TESTE, 10);
});

test('sortear evita a tentativa anterior e completa se faltar', () => {
  const r = sortear(['a', 'b', 'c', 'd'], 3, ['a', 'b', 'c'], () => 0);
  assert.equal(r.length, 3); assert.ok(r.includes('d')); assert.equal(new Set(r).size, 3);
});
test('sortear com banco menor que n usa todas', () => assert.equal(sortear(['a', 'b'], 3).length, 2));
test('sortear não altera as entradas e é determinístico com aleatorio injetado', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']; const evitar = ['a', 'b'];
  const r1 = sortear(ids, 3, evitar, () => 0.5);
  const r2 = sortear(ids, 3, evitar, () => 0.5);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(evitar, ['a', 'b']);
  assert.deepEqual(r1, r2);
  assert.equal(new Set(r1).size, 3);
});
test('sortear prefere ids fora de evitar quando há o bastante', () => {
  const r = sortear(['a', 'b', 'c', 'd', 'e'], 3, ['a', 'b'], Math.random);
  assert.deepEqual([...r].sort(), ['c', 'd', 'e']);
});
test('sortear usa o evitar para completar e nunca repete', () => {
  const r = sortear(['a', 'b', 'c'], 3, ['a', 'b'], () => 0.3);
  assert.deepEqual([...r].sort(), ['a', 'b', 'c']);
});
test('sortear ignora ids de evitar que não estão no banco', () => {
  const r = sortear(['a', 'b'], 2, ['x', 'y'], () => 0);
  assert.deepEqual([...r].sort(), ['a', 'b']);
});

test('aprovado', () => {
  assert.equal(aprovado(3, 3), true); assert.equal(aprovado(2, 3), false);
  assert.equal(aprovado(8, 10), true); assert.equal(aprovado(7, 10), false);
  assert.equal(aprovado(0, 0), false);
});
test('aprovado sem erro de ponto flutuante', () => {
  assert.equal(aprovado(4, 5), true);
  assert.equal(aprovado(16, 20), true);
  assert.equal(aprovado(24, 30), true);
  assert.equal(aprovado(79, 100), false);
});

test('estadoModulos: ordem e final', () => {
  const m = [{ id: '1', ordem: 1 }, { id: '2', ordem: 2 }, { id: '3', ordem: 3 }, { id: 'F', ordem: 8, final: true }];
  assert.deepEqual(estadoModulos(m, { 1: 'TELAS', 2: 'PRE_TESTE' }).map((x) => x.estado), ['FEITO', 'JA_SABIA', 'AGORA', 'TRANCADO']);
  assert.equal(estadoModulos(m, { 1: 'TELAS', 2: 'TELAS', 3: 'TELAS' }).at(-1).estado, 'AGORA');
});
test('estadoModulos: entrada fora de ordem volta em ordem', () => {
  const m = [{ id: 'F', ordem: 8, final: true }, { id: '3', ordem: 3 }, { id: '1', ordem: 1 }, { id: '2', ordem: 2 }];
  const r = estadoModulos(m, { 1: 'CENARIOS' });
  assert.deepEqual(r.map((x) => x.id), ['1', '2', '3', 'F']);
  assert.deepEqual(r.map((x) => x.estado), ['FEITO', 'AGORA', 'TRANCADO', 'TRANCADO']);
});
test('estadoModulos: nada concluído abre só o primeiro; não altera a entrada', () => {
  const m = [{ id: '2', ordem: 2 }, { id: '1', ordem: 1 }, { id: 'F', ordem: 9, final: true }];
  const r = estadoModulos(m, {});
  assert.deepEqual(r.map((x) => x.estado), ['AGORA', 'TRANCADO', 'TRANCADO']);
  assert.deepEqual(m.map((x) => x.id), ['2', '1', 'F']);
});
test('estadoModulos: final só abre com todos os demais concluídos; tudo concluído não deixa AGORA', () => {
  const m = [{ id: '1', ordem: 1 }, { id: '2', ordem: 2 }, { id: 'F', ordem: 3, final: true }];
  assert.equal(estadoModulos(m, { 1: 'TELAS' }).at(-1).estado, 'TRANCADO');
  const tudo = estadoModulos(m, { 1: 'TELAS', 2: 'PRE_TESTE', F: 'CENARIOS' });
  assert.deepEqual(tudo.map((x) => x.estado), ['FEITO', 'JA_SABIA', 'FEITO']);
});
test('estadoModulos: módulo concluído mais adiante não abre os intermediários', () => {
  const m = [{ id: '1', ordem: 1 }, { id: '2', ordem: 2 }, { id: '3', ordem: 3 }];
  assert.deepEqual(estadoModulos(m, { 3: 'TELAS' }).map((x) => x.estado), ['AGORA', 'TRANCADO', 'FEITO']);
});

test('proximoPasso: tela, depois teste, depois próximo tópico', () => {
  const t = [{ id: 't1', telas: [{ id: 'a' }, { id: 'b' }] }, { id: 't2', telas: [{ id: 'c' }] }];
  assert.deepEqual(proximoPasso(t, new Set(['a']), new Set()), { tipo: 'tela', id: 'b' });
  assert.deepEqual(proximoPasso(t, new Set(['a', 'b']), new Set()), { tipo: 'teste', topicoId: 't1' });
  assert.deepEqual(proximoPasso(t, new Set(['a', 'b']), new Set(['t1'])), { tipo: 'tela', id: 'c' });
  assert.equal(proximoPasso(t, new Set(['a', 'b', 'c']), new Set(['t1', 't2'])), null);
});
test('proximoPasso: tópico sem telas vai direto ao teste; aprovado é pulado', () => {
  const t = [{ id: 't1', telas: [] }, { id: 't2', telas: [{ id: 'c' }] }];
  assert.deepEqual(proximoPasso(t, new Set(), new Set()), { tipo: 'teste', topicoId: 't1' });
  assert.deepEqual(proximoPasso(t, new Set(), new Set(['t1'])), { tipo: 'tela', id: 'c' });
  assert.equal(proximoPasso([], new Set(), new Set()), null);
});

test('situacaoAtual expira só ATIVA vencida', () => {
  const ontem = new Date(Date.now() - 864e5);
  assert.equal(situacaoAtual({ situacao: 'ATIVA', acessoAte: ontem }), 'EXPIRADA');
  assert.equal(situacaoAtual({ situacao: 'CONCLUIDA', acessoAte: ontem }), 'CONCLUIDA');
});
test('situacaoAtual: acessoAte nulo, no futuro ou outras situações ficam como estão', () => {
  const agora = new Date('2026-10-27T12:00:00Z');
  assert.equal(situacaoAtual({ situacao: 'ATIVA', acessoAte: null }, agora), 'ATIVA');
  assert.equal(situacaoAtual({ situacao: 'ATIVA', acessoAte: new Date('2026-10-28T00:00:00Z') }, agora), 'ATIVA');
  assert.equal(situacaoAtual({ situacao: 'ATIVA', acessoAte: new Date('2026-10-26T00:00:00Z') }, agora), 'EXPIRADA');
  assert.equal(situacaoAtual({ situacao: 'AGUARDANDO_PAGAMENTO', acessoAte: new Date('2020-01-01') }, agora), 'AGUARDANDO_PAGAMENTO');
  assert.equal(situacaoAtual({ situacao: 'CANCELADA', acessoAte: new Date('2020-01-01') }, agora), 'CANCELADA');
});

test('prazos', () => {
  assert.equal(calcularAcessoAte(new Date('2026-10-27T12:00:00Z'), 365).toISOString(), '2027-10-27T12:00:00.000Z');
  assert.equal(calcularValidoAte(new Date('2026-11-03T12:00:00Z'), 24).toISOString().slice(0, 10), '2028-11-03');
  assert.equal(calcularValidoAte(new Date('2026-01-31T12:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28');
});
test('prazos: bissexto, virada de ano, horário preservado e entrada intacta', () => {
  assert.equal(calcularValidoAte(new Date('2027-12-31T12:00:00Z'), 2).toISOString().slice(0, 10), '2028-02-29');
  assert.equal(calcularValidoAte(new Date('2026-11-15T12:00:00Z'), 3).toISOString().slice(0, 10), '2027-02-15');
  const base = new Date('2026-01-31T15:45:30.123Z');
  assert.equal(calcularValidoAte(base, 1).toISOString(), '2026-02-28T15:45:30.123Z');
  assert.equal(base.toISOString(), '2026-01-31T15:45:30.123Z');
  assert.equal(calcularAcessoAte(base, 1).toISOString(), '2026-02-01T15:45:30.123Z');
  assert.equal(base.toISOString(), '2026-01-31T15:45:30.123Z');
});

test('efeitoNaInscricao', () => {
  assert.equal(efeitoNaInscricao('AGUARDANDO_PAGAMENTO', 'PAGO'), 'ATIVA');
  assert.equal(efeitoNaInscricao('ATIVA', 'PAGO'), null);
  assert.equal(efeitoNaInscricao('CANCELADA', 'PAGO'), null);
  assert.equal(efeitoNaInscricao('ATIVA', 'ESTORNADO'), 'CANCELADA');
  assert.equal(efeitoNaInscricao('AGUARDANDO_PAGAMENTO', 'CANCELADO'), null);
});
test('efeitoNaInscricao: estorno de concluída cancela; cobrança recusada nunca muda', () => {
  assert.equal(efeitoNaInscricao('CONCLUIDA', 'ESTORNADO'), 'CANCELADA');
  assert.equal(efeitoNaInscricao('AGUARDANDO_PAGAMENTO', 'ESTORNADO'), null);
  assert.equal(efeitoNaInscricao('EXPIRADA', 'ESTORNADO'), null);
  assert.equal(efeitoNaInscricao('CANCELADA', 'ESTORNADO'), null);
  assert.equal(efeitoNaInscricao('EXPIRADA', 'PAGO'), null);
  assert.equal(efeitoNaInscricao('CONCLUIDA', 'PAGO'), null);
  for (const s of ['AGUARDANDO_PAGAMENTO', 'ATIVA', 'CONCLUIDA', 'EXPIRADA', 'CANCELADA']) {
    assert.equal(efeitoNaInscricao(s, 'CANCELADO'), null);
  }
});

test('valorCobranca', () => {
  const c = { precoAvista: 79.9, precoCheio: 89.9, parcelas: 3 };
  assert.deepEqual(valorCobranca(c, { plano: 'A_VISTA', parcelas: 1 }), { valor: 79.9, parcelas: 1 });
  assert.deepEqual(valorCobranca(c, { plano: 'PARCELADO', parcelas: 3 }), { valor: 89.9, parcelas: 3 });
  assert.throws(() => valorCobranca(c, { plano: 'PARCELADO', parcelas: 4 }));
  assert.throws(() => valorCobranca(c, { plano: 'PARCELADO', parcelas: 1 }));
});
test('valorCobranca: regras extras e preços Decimal', () => {
  const dec = (n) => ({ toString: () => String(n), valueOf: () => n }); // imita Prisma Decimal
  const c = { precoAvista: dec(79.9), precoCheio: dec(89.9), parcelas: 3 };
  assert.deepEqual(valorCobranca(c, { plano: 'A_VISTA', parcelas: 1 }), { valor: 79.9, parcelas: 1 });
  assert.deepEqual(valorCobranca(c, { plano: 'PARCELADO', parcelas: 2 }), { valor: 89.9, parcelas: 2 });
  assert.throws(() => valorCobranca(c, { plano: 'A_VISTA', parcelas: 3 }), /parcelas inválidas/);
  assert.throws(() => valorCobranca(c, { plano: 'PARCELADO', parcelas: 2.5 }), /parcelas inválidas/);
  assert.throws(() => valorCobranca(c, { plano: 'PARCELADO', parcelas: 0 }), /parcelas inválidas/);
  assert.throws(() => valorCobranca(c, { plano: 'PARCELADO', parcelas: '3' }), /parcelas inválidas/);
  assert.throws(() => valorCobranca(c, { plano: 'PIX', parcelas: 1 }));
});
