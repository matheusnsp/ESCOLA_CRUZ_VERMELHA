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
  const baseUrl = isCredito 
    ? 'https://api.cloud.unicopag.com.br' 
    : 'https://vps1.unicopag.com.br';
    
  // 💡 FIX INTELIGENTE: Detecta se está no Render através do link direto ou usa o fallback seguro
  const appUrl = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';
  const paymentMethod = isCredito ? 'credit_card' : 'pix';
  const endpoint = '/public/v1/payments';

  const valorTratado = parseFloat(valorTotal || 0).toFixed(2);
  const amountCentavos = Math.round(parseFloat(valorTratado) * 100);

  const payload = {
    amount: amountCentavos,
    payment_method: paymentMethod,
    installments: isCredito ? Number(dadosCartao?.parcelas || 1) : 1,
    interest_free: true, 
    postback_url: `${appUrl}/webhook/unicopag`, // 💡 Agora sempre enviará uma URL externa válida no Render
    expire_in_days: 1,
    origin: "minha-aplicacao",
    customer: {
      name: aluno.nome,
      email: aluno.email,
      phone_number: apenasNumeros(aluno.celular || '21999999999'),
      document: apenasNumeros(aluno.cpfCnpj),
      zip_code: apenasNumeros(aluno.cep) || "01001000",
      street_name: aluno.logradouro || "Não Informado",
      number: aluno.numero || "SN",
      complement: aluno.complemento || null,
      neighborhood: aluno.bairro || "Centro",
      city: aluno.cidade || "Rio de Janeiro",
      state: aluno.uf || "RJ"
    },
    cart: [{
      hash: matriculaId,
      title: nomeCurso,
      price: amountCentavos,
      quantity: 1,
      operation_type: 1
    }],
    metadata: { order_id: matriculaId }
  };

  if (isCredito) {
    if (!dadosCartao || !dadosCartao.numero || !dadosCartao.cvv) {
      throw new Error('Dados do cartão de crédito incompletos.');
    }

    payload.card = {
      number: apenasNumeros(dadosCartao.numero),
      holdername: dadosCartao.titular,
      exp_month: String(dadosCartao.mesExpiracao).padStart(2, '0'),
      exp_year: String(dadosCartao.anoExpiracao),
      cvv: String(dadosCartao.cvv)
    };
  }

  console.log(`[UnicopAg] Enviando para: ${baseUrl} | Método: ${paymentMethod}`);

  const urlFinal = `${baseUrl}${endpoint}?api_token=${token.trim()}`;
  
  const response = await fetch(urlFinal, {
    method: 'POST', 
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const textBody = await response.text();

  if (!response.ok) {
    console.error(`[UnicopAg] Erro HTTP ${response.status}: ${textBody}`);
    throw new Error(`Gateway: ${textBody || 'Erro desconhecido'}`);
  }

  const json = JSON.parse(textBody);
  const result = json.result || json;
  
  // 💡 MAPEAMENTO UNIFICADO: Alinhado perfeitamente com o tratamento do cursos.js
  return {
    success: true,
    gatewayRef: String(result.id || result.hash || matriculaId),
    paymentStatus: result.payment_status || 'pending',
    installments: result.installments || (isCredito ? Number(dadosCartao?.parcelas || 1) : 1),
    pixQrCode: result.pix ? (result.pix.pix_qr_code || result.pix.qrcode) : null,
    pixUrl: result.pix ? (result.pix.pix_qr_code || result.pix.pix_url) : null,
    checkoutUrl: result.checkout_url || null
  };
}

module.exports = { criarTransacao };