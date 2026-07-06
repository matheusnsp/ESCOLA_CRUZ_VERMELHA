const fetch = require('node-fetch');

/**
 * Sanitiza strings deixando apenas números
 */
function apenasNumeros(valor) {
  if (!valor) return '';
  return String(valor).replace(/\D/g, '');
}

/**
 * Cria uma transação transparente na Únicopag (Pix ou Crédito)
 */
async function criarTransacao({ matriculaId, nomeCurso, valorTotal, forma, aluno, dadosCartao }) {
  const token = process.env.UNICOPAG_API_TOKEN;

  if (!token) {
    throw new Error('Chave UNICOPAG_API_TOKEN não configurada no ambiente (.env)');
  }

  const isCredito = forma === 'CREDITO';
  const appUrl = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';

  const valorTratado = parseFloat(valorTotal || 0).toFixed(2);
  const amountCentavos = Math.round(parseFloat(valorTratado) * 100);

  const baseUrl = isCredito
    ? 'https://api.cloud.unicopag.com.br'
    : 'https://xpix.unicopag.com.br/api';

  const endpoint = isCredito ? '/public/v1/payments' : '/v1/payments/pix';
  const urlFinal = `${baseUrl}${endpoint}`;

  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  let urlComAuth = urlFinal;

  if (isCredito) {
    urlComAuth = `${urlFinal}?api_token=${token.trim()}`;
  } else {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }

  let payload;

  if (isCredito) {
    payload = {
      amount: amountCentavos,
      payment_method: 'credit_card',
      installments: Number(dadosCartao.parcelas || 1),
      postback_url: `${appUrl}/webhook/unicopag`,
      metadata: {
        order_id: String(matriculaId)
      },
      customer: {
        name: aluno.nome,
        email: aluno.email,
        phone_number: apenasNumeros(aluno.celular),
        document: apenasNumeros(aluno.cpfCnpj),
        zip_code: apenasNumeros(aluno.cep),
        street_name: aluno.logradouro || 'Rua não informada',
        number: aluno.numero || 'SN',
        complement: aluno.complemento || '',
        neighborhood: aluno.bairro || 'Bairro não informado',
        city: aluno.cidade || 'Rio de Janeiro',
        state: aluno.uf || 'RJ'
      },
      cart: [{
        id: String(matriculaId),
        hash: String(matriculaId),
        title: nomeCurso,
        price: amountCentavos,
        quantity: 1,
        operation_type: 1
      }],
      card: {
        number: apenasNumeros(dadosCartao.numero),
        holdername: dadosCartao.titular,
        exp_month: String(dadosCartao.mesExpiracao).padStart(2, '0'),
        exp_year: String(dadosCartao.anoExpiracao),
        cvv: String(dadosCartao.cvv)
      }
    };
  } else {
    payload = {
      amount: amountCentavos,
      postback_url: `${appUrl}/webhook/unicopag`,
      customer: {
        name: aluno.nome,
        email: aluno.email,
        phone_number: Number(apenasNumeros(aluno.celular)) || 0,
        document: Number(apenasNumeros(aluno.cpfCnpj)) || 0,
        complement: aluno.complemento || null
      },
      cart: [{
        hash: String(matriculaId),
        title: nomeCurso,
        price: amountCentavos,
        quantity: 1,
        operation_type: "1"
      }]
    };
  }

  console.log(`[MONITORAMENTO CARTÃO] ➡️ 1. Enviando Transação. Matrícula Original: ${matriculaId} | Método: ${isCredito ? 'credit_card' : 'pix'}`);

  const fetchOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };

  // PIX: FIRE-AND-FORGET
  // O gateway xpix.unicopag.com.br sempre retorna 504 depois de ~30s, mas a transação
  // É criada do lado deles — confirmado pelo webhook "transaction.created" que chega
  // normalmente. Não faz sentido bloquear o usuário esperando uma resposta que nunca vem.
  // Disparamos o fetch em background (sem await) e retornamos imediatamente com
  // fireAndForget:true. O cursos.js vai redirecionar o usuário para a página de espera
  // e o webhook vai atualizar o status quando o Pix for confirmado.
  if (!isCredito) {
    console.log('[PIX] Payload enviado:', JSON.stringify(payload));
    fetch(urlComAuth, fetchOptions)
      .then(async (response) => {
        const textBody = await response.text();
        if (!response.ok) {
          console.error(`[PIX] ❌ Resposta de erro do gateway (${response.status}):`, textBody);
          return;
        }
        try {
          const json = JSON.parse(textBody);
          const result = json.result || json;
          console.log(`[PIX] ✅ Resposta assíncrona recebida. hash: ${result.hash} | id: ${result.id}`);
          console.log('[PIX] Objeto pix completo:', JSON.stringify(result.pix));
        } catch (e) {
          console.warn('[PIX] Resposta não era JSON:', textBody.slice(0, 200));
        }
      })
      .catch((err) => {
        // 504/timeout esperado — a transação pode ter sido criada mesmo assim. O webhook confirma.
        console.warn(`[PIX] ⚠️ Fetch em background encerrou com erro (normal se 504): ${err.message}`);
      });

    return { success: true, fireAndForget: true };
  }

  // CARTÃO: fluxo síncrono normal
  const response = await fetch(urlComAuth, fetchOptions);
  const textBody = await response.text();

  if (!response.ok) {
    console.error(`[MONITORAMENTO CARTÃO] ❌ Erro na API Unicopag (${response.status}):`, textBody);
    throw new Error(`Gateway: ${textBody || 'Erro desconhecido'}`);
  }

  const json = JSON.parse(textBody);
  const result = json.result || json;

  console.log(`[MONITORAMENTO CARTÃO] ⬅️ 2. Resposta da API recebida. hash gerado: ${result.hash} | id gerado: ${result.id}`);

  return {
    success: true,
    gatewayRef: String(result.hash || result.id || matriculaId),
    paymentStatus: result.payment_status || 'pending',
    installments: result.installments || Number(dadosCartao.parcelas || 1),
    checkoutUrl: result.checkout_url || null,
    pixQrCode: null,
    pixUrl: null
  };
}

module.exports = { criarTransacao };