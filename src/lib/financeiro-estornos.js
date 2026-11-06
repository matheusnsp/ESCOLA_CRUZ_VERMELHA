// lib/financeiro-estornos.js
//
// Etapa 8 (EAD, mas vale para o presencial): a lista de Estornos do Financeiro lia só as matrículas com status
// ESTORNADO. Quem foi estornado e comprou de novo (a mesma matrícula volta a PENDENTE/PAGO) sumia da lista, e o
// estorno antigo saía do total. Aqui ficam os "estornos extras": para cada matrícula que NÃO está ESTORNADO mas tem
// pagamento de curso ESTORNADO, um estorno — o pagamento estornado mais recente.
// Um só por matrícula (revisão C1): o estorno "apenas contábil" marca TODAS as tentativas da matrícula (PIX vencido,
// cartão recusado…) como ESTORNADO, então contar cada pagamento inflava o total. A matrícula ESTORNADO continua
// contando pelo valorCurso, como sempre. (Duas rodadas de estorno numa mesma matrícula contam só a mais recente.)

const round2 = (x) => Math.round(Number(x) * 100) / 100;

async function estornosExtras(db) {
  const ps = await db.pagamento.findMany({
    where: { status: 'ESTORNADO', tipo: 'CURSO', matricula: { statusPagamento: { not: 'ESTORNADO' } } },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    include: { matricula: { include: { aluno: true, turma: { include: { curso: true } } } } },
  });
  const vistos = new Set();
  return ps
    .filter((p) => p.matricula && !vistos.has(p.matriculaId) && vistos.add(p.matriculaId))
    .map((p) => ({ m: p.matricula, pagamento: p, tipo: 'estornado', valor: round2(p.valor), data: p.atualizadoEm }));
}

const totalEstornado = (matriculasEstornadas, extras) => round2(
  matriculasEstornadas.reduce((s, m) => s + Number(m.valorCurso), 0) + extras.reduce((s, x) => s + x.valor, 0),
);

// Tabela de pagamentos: só o lote recebido é pagamento; o "a receber" fica no cartão e na lista de A receber.
const lotesDaTabela = (linhas) => (linhas || []).filter((x) => x.tipo === 'lote');

module.exports = { estornosExtras, totalEstornado, lotesDaTabela };
