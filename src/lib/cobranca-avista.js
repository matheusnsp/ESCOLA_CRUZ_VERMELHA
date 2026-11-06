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

// Cartão da turma ONLINE: o valor é o da matrícula (preço do curso online, sem taxa), numa vez só. As
// contas do presencial (calcularValores) usariam o preço do curso presencial.
function cobrancaCartaoOnline(matricula) {
  const v = Number(matricula.valorCurso);
  return { valorCobranca: v, valorBase: v, numParcelas: 1, valorParcela: null, tipo: 'CURSO' };
}

// Para onde a tela de retorno leva quando o pagamento confirma.
const destinoAposPagamento = (matricula) => (matricula && matricula.turma && matricula.turma.status === 'ONLINE'
  ? `/online/${matricula.turma.cursoId}`
  : '/minha-conta?inscrito=1');

module.exports = { iniciarCobrancaAVista, urlRetorno, JANELA_PIX_MS, cobrancaCartaoOnline, destinoAposPagamento };
