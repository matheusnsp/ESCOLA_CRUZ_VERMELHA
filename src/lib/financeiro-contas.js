// lib/financeiro-contas.js
//
// Financeiro por conta: onde entrou o dinheiro de cada matrícula. Três "contas":
//   principal  Únicopag da escola (pagamento online pelo site da escola)
//   segunda    Únicopag da instituição (matrícula rápida)
//   manual     recebido na secretaria (maquininha, PIX direto, outro banco) e confirmado à mão
//
// Uma matrícula pode ter dinheiro em duas contas: na matrícula rápida, a taxa entra na instituição e o
// curso, na escola. Por isso o valor é dividido em partes (taxa e curso), cada uma na sua conta.
// Os valores seguem o Financeiro: matrícula paga = valorCurso (o total, curso + taxa); só a inscrição
// paga = valorTaxaMatricula.

const unicopag = require('./unicopag');
const { pagoNoGateway } = require('./matricula-rapida');

const CONTAS = ['principal', 'segunda', 'manual'];

// Conta de um pagamento recebido.
function contaDoPagamento(pg) {
  if (pg.gateway === unicopag.conta('segunda').gateway) return 'segunda';
  return pagoNoGateway(pg) ? unicopag.contaDoGateway(pg.gateway) : 'manual';
}

const centavos = (n) => Math.round(Number(n || 0) * 100) / 100;

// Partes do dinheiro recebido de uma matrícula: [{ conta, valor, parte }]. pagamentos = os Pagamento
// dela. parte: 'taxa' (só a inscrição), 'curso' (só a matrícula) ou 'tudo' (as duas na mesma conta).
function partesRecebidas(m, pagamentos) {
  const pagos = (pagamentos || []).filter((pg) => pg.status === 'PAGO');
  const taxaPg = pagos.find((pg) => pg.tipo === 'TAXA');
  const cursoPg = pagos.find((pg) => pg.tipo === 'CURSO');
  const contaTaxa = taxaPg ? contaDoPagamento(taxaPg) : 'manual';
  const contaCurso = cursoPg ? contaDoPagamento(cursoPg) : (taxaPg && m.plano !== 'A_VISTA' ? 'manual' : contaTaxa);
  const taxa = centavos(m.valorTaxaMatricula);

  if (['PAGO', 'PARCELADO'].includes(m.statusPagamento)) {
    const total = centavos(m.valorCurso);
    // À vista pelo site da escola: uma cobrança só (curso + taxa), sem pagamento de taxa separado.
    if (!taxaPg || !taxa) return [{ conta: contaCurso, valor: total, parte: 'tudo' }];
    const partes = [{ conta: contaTaxa, valor: Math.min(taxa, total), parte: 'taxa' }, { conta: contaCurso, valor: centavos(total - Math.min(taxa, total)), parte: 'curso' }];
    return juntar(partes);
  }
  if (m.taxaConfirmada) return [{ conta: contaTaxa, valor: taxa || 100, parte: 'taxa' }];
  return [];
}

// Soma partes da mesma conta e tira as zeradas.
function juntar(partes) {
  const soma = {};
  for (const p of partes) {
    const j = soma[p.conta];
    soma[p.conta] = j ? { conta: p.conta, valor: centavos(j.valor + p.valor), parte: 'tudo' } : { ...p };
  }
  return Object.values(soma).filter((p) => p.valor > 0);
}

// Nome de cada conta na tela. A principal sem UNICOPAG_NOME no Render aparece como "Escola (site)".
function nomesDasContas() {
  const nomes = { manual: 'Na secretaria' };
  for (const c of unicopag.listarContas()) nomes[c.id] = c.id === 'principal' && c.nome === 'Conta 1' ? 'Escola (site)' : c.nome;
  return nomes;
}

// Partes com a data em que cada uma entrou: taxa = taxaConfirmadaEm; curso ou tudo = confirmadaEm
// (ou, sem ela, taxaConfirmadaEm).
function partesComData(m, pagamentos) {
  return partesRecebidas(m, pagamentos).map((p) => ({
    ...p,
    em: p.parte === 'taxa' ? (m.taxaConfirmadaEm || m.confirmadaEm || m.criadoEm) : (m.confirmadaEm || m.taxaConfirmadaEm || m.criadoEm),
  }));
}

module.exports = { CONTAS, contaDoPagamento, partesRecebidas, partesComData, nomesDasContas };
