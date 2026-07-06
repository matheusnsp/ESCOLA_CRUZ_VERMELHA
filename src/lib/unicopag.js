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
        phone_number: apenasNumeros(aluno.celular),
        document: apenasNumeros(aluno.cpfCnpj),
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

  // PIX: fluxo síncrono com timeout de 35s.
  // O gateway responde com sucesso em ~30s na maioria dos casos.
  // Se estourar o timeout, lançamos erro para o cursos.js tratar com a
  // janela de espera pelo webhook (comportamento anterior mantido como fallback).
  if (!isCredito) {
    console.log('[PIX] Payload enviado:', JSON.stringify(payload));

    const response = await fetch(urlComAuth, {
      ...fetchOptions,
      signal: AbortSignal.timeout(35000),
    });

    const textBody = await response.text();

    if (!response.ok) {
      console.error(`[PIX] ❌ Resposta de erro do gateway (${response.status}):`, textBody);
      throw new Error(`Gateway Pix: ${textBody || 'Erro desconhecido'}`);
    }

    let result;
    try {
      const json = JSON.parse(textBody);
      result = json.result || json;
    } catch (e) {
      console.warn('[PIX] Resposta não era JSON:', textBody.slice(0, 200));
      throw new Error('Gateway Pix retornou resposta inválida.');
    }

    const pix = result.pix || {};
    console.log(`[PIX] ✅ Resposta recebida. hash: ${result.hash} | id: ${result.id}`);
    console.log('[PIX] Objeto pix completo:', JSON.stringify(pix));

    return {
      success: true,
  
      id: result.id || null,
      hash: result.hash || null,
  
      gatewayRef: String(result.hash || result.id || matriculaId),
  
      paymentStatus: result.payment_status || 'pending',
  
      pixQrCode: pix.pix_qr_code || null,
      pixUrl: pix.pix_url || null,
      pixBase64: pix.pix_base64 || null
  };
  }

  // CARTÃO: fluxo síncrono normal
  const response = await fetch(urlComAuth, fetchOptions);
  const textBody = await response.text();

  if (!response.ok) {
    console.error(`[MONITORAMENTO CARTÃO] ❌ Erro na API Unicopag (${response.status}):`, textBody);
    throw new Error(`Gateway: ${textBody || 'Erro desconhecido'}`);
  }

  let json;

  try {
      json = JSON.parse(textBody);
  } catch {
      console.error(textBody);
      throw new Error('Resposta inválida da UnicoPag.');
  }  
  const result = json.result || json;

  console.log(`[MONITORAMENTO CARTÃO] ⬅️ 2. Resposta da API recebida. hash gerado: ${result.hash} | id gerado: ${result.id}`);

  return {
    success: true,
  
    id: result.id || null,
    hash: result.hash || null,
  
    gatewayRef: String(result.hash || result.id || matriculaId),
  
    paymentStatus: result.payment_status || 'pending',
  
    installments: result.installments || Number(dadosCartao.parcelas || 1),
  
    checkoutUrl: result.checkout_url || null,
  
    pixQrCode: null,
    pixUrl: null,
    pixBase64: null
  };
}

module.exports = { criarTransacao };