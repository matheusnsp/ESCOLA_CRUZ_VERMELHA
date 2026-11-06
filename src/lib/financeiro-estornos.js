// lib/financeiro-estornos.js
//
// Etapa 8 (EAD, mas vale para o presencial): a lista de Estornos do Financeiro lia só as matrículas com status
// ESTORNADO. Quem foi estornado e comprou de novo (a mesma matrícula volta a PENDENTE/PAGO) sumia da lista, e o
// estorno antigo saía do total. Aqui ficam os "estornos extras": cada Pagamento de curso ESTORNADO que a linha da
// matrícula não representa — todos os de uma matrícula que não está ESTORNADO e, na que está, todos menos o mais
// recente (esse é a linha da própria matrícula, com o valorCurso). O mesmo dinheiro nunca entra duas vezes.

const round2 = (x) => Math.round(Number(x) * 100) / 100;

async function estornosExtras(db) {
  const ps = await db.pagamento.findMany({
    where: { status: 'ESTORNADO', tipo: 'CURSO' },
    orderBy: { atualizadoEm: 'desc' },
    include: { matricula: { include: { aluno: true, turma: { include: { curso: true } } } } },
  });
  const ultimoDaEstornada = new Map(); // matriculaId → id do estorno mais recente (o da linha da matrícula)
  for (const p of ps) {
    if (p.matricula && p.matricula.statusPagamento === 'ESTORNADO' && !ultimoDaEstornada.has(p.matriculaId)) ultimoDaEstornada.set(p.matriculaId, p.id);
  }
  return ps
    .filter((p) => p.matricula && ultimoDaEstornada.get(p.matriculaId) !== p.id)
    .map((p) => ({ m: p.matricula, pagamento: p, tipo: 'estornado', valor: round2(p.valor), data: p.atualizadoEm }));
}

const totalEstornado = (matriculasEstornadas, extras) => round2(
  matriculasEstornadas.reduce((s, m) => s + Number(m.valorCurso), 0) + extras.reduce((s, x) => s + x.valor, 0),
);

// Tabela de pagamentos: só o lote recebido é pagamento; o "a receber" fica no cartão e na lista de A receber.
const lotesDaTabela = (linhas) => (linhas || []).filter((x) => x.tipo === 'lote');

module.exports = { estornosExtras, totalEstornado, lotesDaTabela };
