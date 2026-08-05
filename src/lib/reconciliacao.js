// 💡 M7 — Reconciliação com o gateway.
//
// Motivo: webhook perdido = pagamento PENDENTE para sempre (foi exatamente o
// incidente que motivou toda esta rodada). A API da Únicopag oferece consulta
// de status por hash (GET /public/v1/transactions/:hash) que o projeto não
// usava. Este módulo varre os Pagamentos PENDENTE com gatewayRef mais velhos
// que N minutos, pergunta o status real ao gateway e aplica a MESMA lógica do
// webhook (TAXA libera etapa 3; CURSO vira PAGO; refund vira ESTORNADO).
//
// Uso:
//   - Como job periódico: importe e chame reconciliarPendentes() num setInterval
//     no server.js (ex.: a cada 15 min).
//   - Como script manual (recomendado para varrer o passivo atual das matrículas
//     antigas): `node -e "require('./src/lib/reconciliacao').reconciliarPendentes({ idadeMinMinutos: 0 }).then(r=>{console.log(r);process.exit(0)})"`
//
// SEGURANÇA: só MEXE em pagamentos que têm gatewayRef (ou seja, passaram pelo
// gateway). Nunca inventa confirmação — só aplica o que o gateway responder.

const prisma = require('../db');
const { consultarTransacao } = require('./unicopag');

function classificar(status) {
  const s = String(status || '').toLowerCase();
  if (['paid', 'pago', 'success', 'captured', 'approved', 'authorized'].includes(s)) return 'SUCESSO';
  if (['refunded', 'reembolsado', 'refund', 'chargeback', 'charged_back', 'estornado', 'reversed'].includes(s)) return 'REEMBOLSO';
  if (['canceled', 'cancelled', 'cancelado', 'voided', 'void', 'refused', 'rejected', 'failed', 'expired'].includes(s)) return 'CANCELAMENTO';
  return 'PENDENTE';
}

/**
 * Aplica o status confirmado a um Pagamento + reflexo na Matrícula.
 * Espelha a lógica do webhook para manter comportamento idêntico.
 */
async function aplicarStatus(pagamento, classe, raw) {
  const novoStatus =
    classe === 'SUCESSO' ? 'PAGO' :
    classe === 'REEMBOLSO' ? 'ESTORNADO' :
    classe === 'CANCELAMENTO' ? 'CANCELADO' : null;
  if (!novoStatus) return null;

  await prisma.pagamento.updateMany({
    where: { id: pagamento.id },
    data: { status: novoStatus, gatewayStatus: `reconciliado:${String(raw && raw.status || '').toLowerCase()}`, gatewayResponse: raw || undefined },
  });

  if (novoStatus === 'PAGO') {
    if (pagamento.tipo === 'TAXA') {
      await prisma.matricula.update({
        where: { id: pagamento.matriculaId },
        data: { taxaConfirmada: true, taxaConfirmadaPor: 'reconciliação', taxaConfirmadaEm: new Date() },
      });
    } else {
      const m = await prisma.matricula.findUnique({ where: { id: pagamento.matriculaId } });
      const st = m && m.plano === 'PARCELADO' ? 'PARCELADO' : 'PAGO';
      await prisma.matricula.update({
        where: { id: pagamento.matriculaId },
        data: { statusPagamento: st, confirmadaEm: new Date(), confirmadaPor: 'reconciliação' },
      });
    }
  } else if (novoStatus === 'ESTORNADO' && pagamento.tipo === 'CURSO') {
    await prisma.matricula.update({
      where: { id: pagamento.matriculaId },
      data: { statusPagamento: 'ESTORNADO' },
    });
  }
  // CANCELADO fica só no Pagamento de propósito (não trava a matrícula para nova tentativa).
  return novoStatus;
}

/**
 * Varre os Pagamentos PENDENTE elegíveis e reconcilia contra o gateway.
 * @param {object} opts
 * @param {number} opts.idadeMinMinutos  Só considera pagamentos criados há mais de X min (default 10) — evita corrida com o webhook normal.
 * @param {number} opts.limite           Máximo de pagamentos por passada (default 200).
 * @returns {Promise<{verificados:number, atualizados:number, porStatus:object}>}
 */
async function reconciliarPendentes(opts = {}) {
  const idadeMinMinutos = opts.idadeMinMinutos != null ? opts.idadeMinMinutos : 10;
  const limite = opts.limite || 200;
  const corte = new Date(Date.now() - idadeMinMinutos * 60000);

  const pendentes = await prisma.pagamento.findMany({
    where: {
      status: 'PENDENTE',
      gatewayRef: { not: null },
      criadoEm: { lt: corte },
    },
    orderBy: { criadoEm: 'asc' },
    take: limite,
  });

  const resumo = { verificados: 0, atualizados: 0, porStatus: {} };

  for (const pag of pendentes) {
    resumo.verificados++;
    const ref = pag.gatewayRef || pag.gatewayHash;
    const info = await consultarTransacao(ref);
    if (!info) continue; // consulta falhou; tenta na próxima passada

    const classe = classificar(info.status);
    if (classe === 'PENDENTE') continue; // ainda não resolveu do lado do gateway

    const novo = await aplicarStatus(pag, classe, info.raw);
    if (novo) {
      resumo.atualizados++;
      resumo.porStatus[novo] = (resumo.porStatus[novo] || 0) + 1;
      console.log(`[RECONCILIACAO] Pagamento ${pag.id} (${pag.tipo}) → ${novo}`);
    }
  }

  console.log(`[RECONCILIACAO] Concluída: ${resumo.verificados} verificados, ${resumo.atualizados} atualizados.`, resumo.porStatus);
  return resumo;
}

module.exports = { reconciliarPendentes };
