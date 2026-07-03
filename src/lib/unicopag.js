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
    
  const paymentMethod = isCredito ? 'credit_card' : 'pix';
  const endpoint = '/public/v1/payments';

  // Transforma em centavos inteiros conforme exige a API
  const valorTratado = parseFloat(valorTotal || 0).toFixed(2);
  const amountCentavos = Math.round(parseFloat(valorTratado) * 100);

  // Mapeamento básico exigido pela API
  const payload = {
    amount: amountCentavos,
    payment_method: paymentMethod,
    installments: isCredito ? Number(dadosCartao?.parcelas || 1) : 1,
    metadata: {
      order_id: String(matriculaId)
    }
  };

  if (isCredito) {
    // Configuração para Cartão de Crédito
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

    payload.customer = {
      name: aluno.nome,
      email: aluno.email,
      cpf_cnpj: apenasNumeros(aluno.cpfCnpj),
      phone: apenasNumeros(aluno.celular)
    };
  } else {
    // 💡 AJUSTE PIX: Campos obrigatórios do seu script de teste de sucesso
    payload.expire_in_days = 1;
    payload.origin = "minha-aplicacao";
    payload.postback_url = process.env.WEBHOOK_URL || "";

    // Mapeamento do objeto customer para o PIX (chaves em inglês conforme o teste)
    payload.customer = {
      name: aluno.nome,
      email: aluno.email,
      phone_number: apenasNumeros(aluno.celular || '21999999999'),
      document: apenasNumeros(aluno.cpfCnpj),
      zip_code: apenasNumeros(aluno.cep || '01001000'),
      street_name: aluno.logradouro || 'Praça da Sé',
      number: aluno.numero || '100',
      complement: aluno.complement || 'Apto 45',
      neighborhood: aluno.bairro || 'Centro',
      city: aluno.cidade || 'Rio de Janeiro',
      state: aluno.uf || 'RJ'
    };

    // Estrutura do carrinho (cart) que é estritamente obrigatória no PIX
    payload.cart = [
      {
        hash: String(matriculaId),
        title: nomeCurso || "Inscrição de Curso",
        price: amountCentavos,
        quantity: 1,
        operation_type: 1
      }
    ];
  }

  console.log(`[UnicopAg] Enviando para: ${baseUrl} | Método: ${paymentMethod}`);

  const urlFinal = `${baseUrl.replace(/\/$/, '')}${endpoint}?api_token=${token.trim()}`;
  
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
  
  // Estrutura base de retorno uniforme
  const retorno = {
    success: true,
    gatewayRef: String(result.id || result.hash || matriculaId),
    paymentStatus: result.payment_status || 'pending',
    installments: result.installments || (isCredito ? Number(dadosCartao?.parcelas || 1) : 1),
    checkoutUrl: result.checkout_url || null,
    // 💡 SOLUÇÃO: Garante que a string do Pix Copia e Cola vá para ambos os campos, alimentando o 'url' que o EJS espera
    pixQrCode: result.pix ? (result.pix.pix_qr_code || result.pix.pix_url) : null,
    pixUrl: result.pix ? (result.pix.pix_qr_code || result.pix.pix_url) : null
  };

  return retorno;
}

module.exports = {
  criarTransacao
};