const fetch = require('node-fetch');

/**
 * Sanitiza strings deixando apenas números (útil para CPF e Telefone)
 */
function apenasNumeros(valor) {
  if (!valor) return '';
  return valor.replace(/\D/g, '');
}

/**
 * Cria uma transação de Pix ou Redirecionamento de Cartão na Únicopag
 */
async function criarTransacao({ matriculaId, nomeCurso, valorTotal, forma, aluno }) {
  const token = process.env.UNICOPAG_API_TOKEN;
  const baseUrl = process.env.UNICOPAG_API_URL || 'https://vps1.unicopag.com.br';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  if (!token) {
    throw new Error('Chave UNICOPAG_API_TOKEN não configurada no ambiente (.env)');
  }

  // 1. Mapeia para "checkout" quando for crédito, forçando a criação do link externo
  // Se for PIX, mantém "pix" para pegar o QR Code direto na tela
  const paymentMethod = forma === 'CREDITO' ? 'checkout' : 'pix';

  // 2. Converte o valor de Float/Decimal para centavos (Inteiro)
  const amountCentavos = Math.round(parseFloat(valorTotal) * 100);

  // 3. Monta o Payload ajustado para Checkout Externo
  const payload = {
    payment_method: paymentMethod,
    amount: amountCentavos,
    installments: 1,
    postback_url: `${appUrl}/webhook/unicopag`,
    expire_in_days: 3,
    origin: "minha-aplicacao",
    customer: {
      name: aluno.nome,
      email: aluno.email,
      document: apenasNumeros(aluno.cpfCnpj),
      phone_number: apenasNumeros(aluno.celular),
      // Endereço mapeado do banco para evitar rejeições cadastrais
      zip_code: apenasNumeros(aluno.cep) || "01001000",
      street_name: aluno.logradouro || "Não Informado",
      number: aluno.numero || "SN",
      complement: aluno.complement || "",
      neighborhood: aluno.bairro || "",
      city: aluno.cidade || "",
      state: aluno.uf || ""
    },
    cart: [
      {
        hash: matriculaId,
        title: nomeCurso,
        price: amountCentavos,
        quantity: 1,
        operation_type: 1
      }
    ],
    metadata: {
      order_id: matriculaId
    }
  };

  console.log(`[UnicopAg] APP_URL em uso: ${appUrl}`);
  console.log(`[UnicopAg] Payload gerado para o método: ${paymentMethod}`);

  // 4. Constrói a URL injetando o api_token como Query Parameter
  const urlFinal = `${baseUrl.replace(/\/$/, '')}/public/v1/payments?api_token=${token.trim()}`;
  
  let response;
  let textBody = '';

  try {
    response = await fetch(urlFinal, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    textBody = await response.text();
  } catch (fetchError) {
    console.error('[UnicopAg] Erro físico de rede/conexão:', fetchError.message);
    throw new Error('Falha ao conectar com o servidor de pagamentos.');
  }

  // 5. Trata respostas com erro do Gateway
  if (!response.ok) {
    console.error(`[UnicopAg] Status HTTP: ${response.status} | Resposta: ${textBody}`);
    throw new Error(`Gateway respondeu com erro ${response.status}`);
  }

  // 6. Resposta de Sucesso: Repassa o checkout_url para o seu cursos.js redirecionar
  try {
    const json = JSON.parse(textBody);
    const pixData = json.result?.pix || json.pix || null;
    const stringPix = pixData ? (pixData.pix_qr_code || pixData.qrcode || pixData.copy_and_paste) : null;
    
    return {
      success: true,
      gatewayRef: json.result?.id || json.id || matriculaId,
      // Captura a URL da página de pagamento da Únicopag
      checkoutUrl: json.result?.checkout_url || json.checkout_url || json.result?.payment_url || json.payment_url || null,
      pixQrCode: stringPix,
      pixUrl: stringPix
    };
  } catch (parseError) {
    console.error('[UnicopAg] Erro ao processar JSON de sucesso do gateway:', parseError.message);
    throw new Error('Resposta de sucesso do gateway veio em formato inválido.');
  }
}

module.exports = { criarTransacao };