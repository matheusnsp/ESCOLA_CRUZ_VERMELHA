// lib/cobranca-avista.js
//
// Cobrança à vista (uma transação só) que antes morava no POST /inscrever (routes/cursos.js) e agora
// também serve à compra do curso online. A matrícula já existe; aqui só se cobra.
//   CREDITO: nenhuma transação aqui. O aluno preenche o cartão na tela de retorno, que chama
//            POST /inscricao/cartao/:id.
//   PIX:     reaproveita o QR dos últimos 30 min (cada clique gerava uma cobrança nova, e cada uma é
//            pagável); senão cria o Pagamento PENDENTE e chama o gateway. Se o gateway falhar, espera um
//            pouco pela ref (o webhook pode gravá-la por fora) antes de cancelar.

const prisma = require('../db');

const JANELA_PIX_MS = 30 * 60 * 1000;
const TENTATIVAS_ESPERA = 15;

function urlRetorno(matriculaId, { pix = false, etapa = 'curso' } = {}) {
  return `/inscricao/retorno?matriculaId=${matriculaId}`
       + `&pix=${pix ? '1' : '0'}&etapa=${etapa}&t=${Date.now()}`;
}

const criarTransacaoPadrao = (...args) => require('./unicopag').criarTransacao(...args);

async function iniciarCobrancaAVista({ matricula, nomeCurso, total, forma, aluno, origem, criarTransacao = criarTransacaoPadrao, esperaMs = 2000 }) {
  const retornoPix = () => ({ redirect: urlRetorno(matricula.id, { pix: true, etapa: 'curso' }) });
  if (forma === 'CREDITO') return { redirect: urlRetorno(matricula.id, { pix: false, etapa: 'curso' }) };

  const pixRecente = await prisma.pagamento.findFirst({
    where: {
      matriculaId: matricula.id,
      tipo: 'CURSO',
      status: 'PENDENTE',
      metodo: 'PIX',
      valor: total, // QR de outro valor (cupom aplicado ou tirado, preço mudado) não serve: gera outro
      pixQrCode: { not: null },
      criadoEm: { gt: new Date(Date.now() - JANELA_PIX_MS) },
    },
    orderBy: { criadoEm: 'desc' },
  });
  if (pixRecente) {
    console.log(`[PIX] Reaproveitando QR existente (${pixRecente.id}) da matrícula ${matricula.id}.`);
    return retornoPix();
  }

  const pagamentoPendente = await prisma.pagamento.create({
    data: { matriculaId: matricula.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: total, status: 'PENDENTE' },
  });

  try {
    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso,
      valorTotal: total,
      forma: 'PIX',
      aluno: { ...aluno, cidade: aluno.cidade || 'Rio de Janeiro' },
      dadosCartao: null,
      tipoPagamento: 'CURSO',
      origem,
    });
    const gatewayRef = String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash || matricula.id);
    await prisma.pagamento.update({
      where: { id: pagamentoPendente.id },
      data: {
        gatewayRef,
        gatewayHash: resultadoGateway.hash || null,
        gatewayStatus: resultadoGateway.paymentStatus || null,
        gatewayResponse: resultadoGateway,
        pixQrCode: resultadoGateway.pixQrCode || null,
        pixUrl: resultadoGateway.pixUrl || null,
        pixBase64: resultadoGateway.pixBase64 || null,
      },
    });
    return retornoPix();
  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway (curso à vista):', err.message);
    // O gateway pode demorar e o nosso lado estourar o tempo com a transação já criada do lado deles:
    // o webhook confirma por fora. Janela curta de espera antes de desistir e cancelar.
    let pagamentoAtual = null;
    for (let tentativa = 0; tentativa < TENTATIVAS_ESPERA; tentativa++) {
      pagamentoAtual = await prisma.pagamento.findUnique({ where: { id: pagamentoPendente.id } });
      if (pagamentoAtual?.gatewayRef) break;
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
    if (pagamentoAtual?.gatewayRef) return retornoPix();
    await prisma.pagamento.updateMany({ where: { id: pagamentoPendente.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
    return { erro: 'Houve um problema ao processar o pagamento. Tente novamente.' };
  }
}

// Cartão da turma ONLINE: o valor é o da matrícula (preço do curso online, já com o cupom, sem taxa). As contas
// do presencial (calcularValores) usariam o preço do curso presencial. Parcelado (etapa 7): o gateway recebe o
// valor BASE e aplica os juros; a opção do Únicopag (installment_amount/total_amount, em centavos) só serve para
// exibir a parcela e o total.
function cobrancaCartaoOnline(matricula, parcelas = 1, opcao = null) {
  const v = Number(matricula.valorCurso);
  const n = Number(parcelas) || 1;
  if (n > 1 && opcao) {
    return { valorCobranca: opcao.total_amount / 100, valorBase: v, numParcelas: n, valorParcela: opcao.installment_amount / 100, tipo: 'CURSO' };
  }
  return { valorCobranca: v, valorBase: v, numParcelas: n, valorParcela: n > 1 ? Math.round((v / n) * 100) / 100 : null, tipo: 'CURSO' };
}

const buscarTabelaPadrao = (centavos) => require('./unicopag').consultarParcelamento(centavos);
const TTL_TABELA_MS = 10 * 60 * 1000;
const tabelas = new Map(); // centavos → { tabela, em }; só respostas boas ficam guardadas

// As opções do seletor de parcelas do curso online: 1x sempre (sem juros); de 2 até max, da tabela do Únicopag
// (uma consulta só por valor, guardada por 10 min). Sem tabela, só 1x.
async function opcoesParcelasOnline(valor, max, buscarTabela = buscarTabelaPadrao) {
  const v = Number(valor);
  const opcoes = [{ n: 1, valorParcela: v, total: v }];
  const limite = Math.min(Number(max) || 1, 12);
  if (limite < 2) return opcoes;
  const centavos = Math.round(v * 100);
  let guardada = tabelas.get(centavos);
  if (!guardada || Date.now() - guardada.em > TTL_TABELA_MS) {
    let tabela = null;
    try { tabela = await buscarTabela(centavos); } catch (e) { tabela = null; }
    guardada = Array.isArray(tabela) ? { tabela, em: Date.now() } : null;
    if (guardada) tabelas.set(centavos, guardada);
  }
  if (!guardada) return opcoes;
  for (let n = 2; n <= limite; n++) {
    const o = guardada.tabela.find((x) => Number(x.installments) === n);
    if (o) opcoes.push({ n, valorParcela: o.installment_amount / 100, total: o.total_amount / 100 });
  }
  return opcoes;
}

// Para onde a tela de retorno leva quando o pagamento confirma.
const destinoAposPagamento = (matricula) => (matricula && matricula.turma && matricula.turma.status === 'ONLINE'
  ? `/online/${matricula.turma.cursoId}`
  : '/minha-conta?inscrito=1');

module.exports = { iniciarCobrancaAVista, urlRetorno, JANELA_PIX_MS, cobrancaCartaoOnline, opcoesParcelasOnline, destinoAposPagamento };
