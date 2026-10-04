// lib/reconciliacao.js — M7: reconciliação com a Únicopag.
//
// Motivo: aviso (webhook) perdido = pagamento PENDENTE para sempre, mesmo com o dinheiro na conta
// (deploy, reinício, falha de rede no meio do caminho). A cada 15 minutos (server.js) esta rotina
// pega os Pagamentos PENDENTE que passaram pela Únicopag (têm gatewayRef), criados entre 10 minutos
// e 7 dias atrás, pergunta a situação de cada um na conta certa e aplica a resposta com a MESMA
// regra do webhook (lib/status-pagamento.js): taxa confirmada, curso pago com o e-mail de matrícula
// confirmada, estorno, ou cancelado (PIX vencido, cartão recusado).
//
//   - Conta certa: Pagamento.gateway 'unicopag-2' → conta da instituição; o resto → conta da
//     escola (unicopag.contaDoGateway). 'manual' nunca entra: não tem transação na Únicopag.
//   - Só aplica o que a Únicopag responder; consulta que falha fica para a próxima passada.
//   - Os 3 serviços do Render rodam este código: uma trava em Configuracao
//     ('reconciliacao:rodada') deixa só um deles fazer cada passada. Se dois rodarem juntos mesmo
//     assim, a trava atômica de lib/status-pagamento.js impede reflexo e e-mail em dobro.
//   - A última passada fica em Configuracao 'reconciliacao:ultima' e cada correção vira uma linha
//     no LogAuditoria (acao 'RECONCILIACAO').
//
// Manual (varrer tudo, sem a janela de 7 dias):
//   node -e "require('./src/lib/reconciliacao').reconciliarPendentes({ idadeMaxDias: 3650, forcar: true }).then((r) => { console.log(r); process.exit(0); })"

const prisma = require('../db');
const unicopag = require('./unicopag');
const { aplicarStatus } = require('./status-pagamento');

const INTERVALO_MIN = 15;
const CHAVE_RODADA = 'reconciliacao:rodada';
const CHAVE_ULTIMA = 'reconciliacao:ultima';

// Pega a vez desta passada. Devolve false se outro serviço já rodou nos últimos ~15 minutos.
async function pegarVez() {
  const agora = new Date();
  const limite = new Date(agora.getTime() - (INTERVALO_MIN - 1) * 60000).toISOString();
  try {
    await prisma.configuracao.create({ data: { chave: CHAVE_RODADA, valor: agora.toISOString() } });
    return true;
  } catch (e) {
    if (e.code !== 'P2002') throw e;
  }
  // Datas ISO em UTC comparam certo como texto.
  const r = await prisma.configuracao.updateMany({
    where: { chave: CHAVE_RODADA, valor: { lt: limite } },
    data: { valor: agora.toISOString() },
  });
  return r.count === 1;
}

/**
 * @param {object} opts
 * @param {number}  opts.idadeMinMinutos  só pagamentos criados há mais de X min (padrão 10), para não correr com o aviso normal
 * @param {number}  opts.idadeMaxDias     só pagamentos dos últimos X dias (padrão 7)
 * @param {number}  opts.limite           máximo por passada (padrão 100)
 * @param {boolean} opts.forcar           ignora a trava entre serviços (uso manual)
 */
async function reconciliarPendentes(opts = {}) {
  const idadeMinMinutos = opts.idadeMinMinutos != null ? opts.idadeMinMinutos : 10;
  const idadeMaxDias = opts.idadeMaxDias || 7;
  const limite = opts.limite || 100;

  if (!opts.forcar && !(await pegarVez())) return { pulada: true };

  const agora = Date.now();
  const pendentes = await prisma.pagamento.findMany({
    where: {
      status: 'PENDENTE',
      gatewayRef: { not: null },
      OR: [{ gateway: null }, { gateway: { not: 'manual' } }], // NOT sozinho deixaria de fora gateway nulo
      criadoEm: { lt: new Date(agora - idadeMinMinutos * 60000), gt: new Date(agora - idadeMaxDias * 86400000) },
    },
    orderBy: { criadoEm: 'desc' },
    take: limite,
  });

  const resumo = { em: new Date().toISOString(), verificados: 0, atualizados: 0, falhas: 0, porStatus: {} };

  for (const pag of pendentes) {
    const contaId = unicopag.contaDoGateway(pag.gateway);
    if (!unicopag.conta(contaId).token) continue; // conta sem chave neste serviço
    resumo.verificados++;
    const info = await unicopag.consultarTransacao(pag.gatewayRef, contaId);
    if (!info) { resumo.falhas++; continue; }

    let r;
    try {
      r = await aplicarStatus(pag, { status: info.status, payload: info.raw, tx: info.raw, origem: 'reconciliacao', gravarPendente: false });
    } catch (e) {
      resumo.falhas++;
      console.error(`[RECONCILIACAO] Pagamento ${pag.id}:`, e.message);
      continue;
    }
    if (!r.novoStatus) continue; // ainda pendente na Únicopag, ou já resolvido

    resumo.atualizados++;
    resumo.porStatus[r.novoStatus] = (resumo.porStatus[r.novoStatus] || 0) + 1;
    console.log(`[RECONCILIACAO] Pagamento ${pag.id} (${pag.tipo}, conta ${contaId}) → ${r.novoStatus}`);
    await prisma.logAuditoria.create({
      data: { atorId: 'SISTEMA', acao: 'RECONCILIACAO', alvoTipo: 'Pagamento', alvoId: pag.id, detalhe: { matriculaId: pag.matriculaId, tipo: pag.tipo, conta: contaId, de: 'PENDENTE', para: r.novoStatus, statusUnicopag: info.status } },
    }).catch((e) => console.warn('[RECONCILIACAO] log:', e.message));
  }

  if (resumo.verificados) {
    console.log(`[RECONCILIACAO] ${resumo.verificados} verificados, ${resumo.atualizados} atualizados, ${resumo.falhas} sem resposta.`, resumo.porStatus);
  }
  const valor = JSON.stringify(resumo);
  await prisma.configuracao.upsert({ where: { chave: CHAVE_ULTIMA }, update: { valor }, create: { chave: CHAVE_ULTIMA, valor } }).catch(() => {});
  return resumo;
}

// Liga a passada periódica (server.js). A primeira sai 2 minutos depois de subir, para não pesar
// no início do serviço.
function agendar() {
  const rodar = () => reconciliarPendentes().catch((e) => console.error('[RECONCILIACAO] falhou:', e.message));
  setTimeout(rodar, 2 * 60000).unref();
  setInterval(rodar, INTERVALO_MIN * 60000).unref();
}

module.exports = { reconciliarPendentes, agendar };
