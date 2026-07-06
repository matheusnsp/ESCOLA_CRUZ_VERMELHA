const fetch = require('node-fetch');
const AbortController = require('abort-controller');

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
    // Schema CreatePixPaymentRequest conforme doc oficial (xpix.unicopag.com.br/api).
    // - phone_number e document são type:number (sem formatação, só dígitos como inteiro)
    // - operation_type é enum de strings: "1" | "2" | "3"
    // - Não há payment_method, installments, metadata, expire_in_days nem campos de endereço
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
        // 🔄 CORRIGIDO: o enum da doc define os valores como strings ("1","2","3"),
        // não como número inteiro 1. Enviamos "1" (direct_sale) conforme o schema.
        operation_type: "1"
      }]
    };
  }

  console.log(`[MONITORAMENTO CARTÃO] ➡️ 1. Enviando Transação. Matrícula Original: ${matriculaId} | Método: ${isCredito ? 'credit_card' : 'pix'}`);
  if (!isCredito) {
    // Log do payload completo do Pix para diagnóstico — remova após confirmar funcionamento
    console.log('[PIX] Payload enviado:', JSON.stringify(payload));
  }

  // 🔄 CORRIGIDO: adicionamos um AbortController com timeout de 35s para o Pix.
  // O nginx do gateway deles retorna 504 depois de ~30s. Com esse timeout, garantimos
  // que o fetch não fica pendurado indefinidamente, mas ainda segura tempo suficiente
  // para que o webhook "transaction.created" (que chega em paralelo) possa ser
  // processado pelo server.js e gravar o gatewayRef antes de espirarmos a espera
  // em cursos.js. Para cartão mantemos sem timeout (API síncrona e confiável).
  let fetchOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };

  if (!isCredito) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);
    fetchOptions.signal = controller.signal;

    let response, textBody;
    try {
      response = await fetch(urlComAuth, fetchOptions);
      clearTimeout(timeoutId);
      textBody = await response.text();
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      // AbortError significa que estouramos os 35s — tratamos como erro de gateway
      // para que o bloco de espera em cursos.js tome conta do fluxo.
      const msg = fetchErr.name === 'AbortError' ? 'Gateway: timeout após 35s' : `Gateway: ${fetchErr.message}`;
      throw new Error(msg);
    }

    if (!response.ok) {
      console.error(`[MONITORAMENTO CARTÃO] ❌ Erro na API Unicopag Pix (${response.status}):`, textBody);
      throw new Error(`Gateway: ${textBody || 'Erro desconhecido'}`);
    }

    const json = JSON.parse(textBody);
    const result = json.result || json;

    console.log(`[MONITORAMENTO CARTÃO] ⬅️ 2. Resposta Pix recebida. hash: ${result.hash} | id: ${result.id}`);
    console.log('[PIX] Objeto pix na resposta:', JSON.stringify(result.pix));

    return {
      success: true,
      gatewayRef: String(result.hash || result.id || matriculaId),
      paymentStatus: result.payment_status || 'pending',
      installments: 1,
      checkoutUrl: result.checkout_url || null,
      // ⚠️ Os nomes dos campos dentro de result.pix não estão documentados na spec.
      // Logamos o objeto completo acima — ajuste os campos abaixo após ver o log real.
      pixQrCode: result.pix?.pix_qr_code || result.pix?.qr_code || result.pix?.emv || null,
      pixUrl: result.pix?.pix_url || result.pix?.url || result.pix?.copy_paste || null
    };
  }

  // Cartão: fluxo original sem timeout
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