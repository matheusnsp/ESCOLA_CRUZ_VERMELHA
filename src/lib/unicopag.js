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

  // 🔄 ATUALIZADO conforme a doc oficial (openapi ÚnicoPag API, servidor
  // https://xpix.unicopag.com.br/api): o Pix agora passa por um microserviço próprio
  // (MagenPay), diferente do domínio antigo vps1.unicopag.com.br. O cartão continua
  // sem documentação nova, então mantemos api.cloud.unicopag.com.br como estava.
  const baseUrl = isCredito
    ? 'https://api.cloud.unicopag.com.br'
    : 'https://xpix.unicopag.com.br/api';

  const endpoint = isCredito ? '/public/v1/payments' : '/v1/payments/pix';
  const urlFinal = `${baseUrl}${endpoint}`;

  // 🔄 ATUALIZADO: a doc nova do Pix diz explicitamente "Envie o token da API pública no
  // header Authorization: Bearer {token}". Antes mandávamos o token via query string
  // (?api_token=...). Pro cartão, como não tem doc nova, mantemos o api_token na URL
  // (igual já funcionava) e mandamos os dois formatos de auth não atrapalha.
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
    // 🔄 ATUALIZADO: o schema CreatePixPaymentRequest da doc nova só aceita amount,
    // postback_url, customer{name,email,phone_number,document,complement} e
    // cart[{hash,title,price,quantity,operation_type}]. Removi payment_method,
    // installments, metadata, expire_in_days, origin e os campos de endereço
    // (zip_code/street_name/number/neighborhood/city/state) do customer — nenhum deles
    // existe nesse schema, e phone_number/document agora são number, não string.
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
        operation_type: 1
      }]
    };
  }

  console.log(`[MONITORAMENTO CARTÃO] ➡️ 1. Enviando Transação. Matrícula Original: ${matriculaId} | Método: ${isCredito ? 'credit_card' : 'pix'}`);

  // O domínio do Pix antigo (vps1.unicopag.com.br) tinha histórico de 504 e por isso não
  // colocávamos timeout aqui — o catch em cursos.js (com tolerância) que decidia cancelar
  // ou não. Mantemos essa mesma filosofia agora com o novo domínio (xpix.unicopag.com.br)
  // até termos confirmação de que ele não sofre do mesmo problema.
  const response = await fetch(urlComAuth, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const textBody = await response.text();

  if (!response.ok) {
    console.error(`[MONITORAMENTO CARTÃO] ❌ Erro na API Unicopag (${response.status}):`, textBody);
    throw new Error(`Gateway: ${textBody || 'Erro desconhecido'}`);
  }

  const json = JSON.parse(textBody);
  const result = json.result || json;

  console.log(`[MONITORAMENTO CARTÃO] ⬅️ 2. Resposta da API recebida. hash gerado: ${result.hash} | id gerado: ${result.id}`);

  // ⚠️ ATENÇÃO: a doc nova (PaymentResource) define "pix" só como "object | null", sem
  // detalhar os campos internos. Mantive pix_qr_code/pix_url como primeira tentativa
  // (era o que funcionava confirmado por log real antes da mudança), mas isso NÃO está
  // confirmado pra esse novo endpoint. Se vier null mesmo com a transação criada, cole
  // aqui o `textBody` de uma transação de teste real que eu ajusto os nomes certos.
  return {
    success: true,
    gatewayRef: String(result.hash || result.id || matriculaId),
    paymentStatus: result.payment_status || 'pending',
    installments: result.installments || (isCredito ? Number(dadosCartao.parcelas || 1) : 1),
    checkoutUrl: result.checkout_url || null,
    pixQrCode: result.pix?.pix_qr_code || null,
    pixUrl: result.pix?.pix_url || null
  };
}

module.exports = { criarTransacao };