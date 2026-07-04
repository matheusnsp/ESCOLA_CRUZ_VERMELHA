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
    
  const appUrl = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';
  const paymentMethod = isCredito ? 'credit_card' : 'pix';
  const endpoint = '/public/v1/payments';

  const valorTratado = parseFloat(valorTotal || 0).toFixed(2);
  const amountCentavos = Math.round(parseFloat(valorTratado) * 100);

  // ⚠️ Sobre antifraude: a documentação da Únicopag diz que a integração com o sistema de
  // antifraude (ThreatMetrix) é obrigatória para cartão. O log real de uma transação de teste
  // mostrou "payment_status":"paid" — ou seja, o gateway ESTÁ aprovando a transação
  // normalmente mesmo sem esse profiling implementado. Então isso não é a causa do problema
  // relatado (matrícula não atualiza); o problema era 100% reconciliação no /webhook/unicopag,
  // já corrigido em cursos.js. Ainda assim, vale implementar o antifraude a médio prazo — sem
  // ele você fica mais exposto a fraude/chargeback, mesmo que hoje as transações passem.
  const payload = {
    amount: amountCentavos,
    payment_method: paymentMethod,
    installments: isCredito ? Number(dadosCartao.parcelas || 1) : 1,
    postback_url: `${appUrl}/webhook/unicopag`,
    // 💡 CORRIGIDO (PIX): o script de teste que a Únicopag confirmou funcionar manda
    // "expire_in_days" e "origin" — campos que o código antigo não mandava. Faz sentido pro
    // Pix especificamente (precisa de uma validade pro QR code, diferente do cartão que é
    // processado na hora) e é bem provável que a ausência desses campos seja a causa real dos
    // 504 no vps1.unicopag.com.br: a rota fica "pendurada" tentando gerar um Pix sem prazo de
    // expiração em vez de responder rápido com erro de validação. Mandamos só no Pix pra não
    // mudar nada do payload que já funciona no cartão.
    ...(!isCredito ? { expire_in_days: 1, origin: 'escola-cruz-vermelha' } : {}),
    // Confirmado por log real de produção: a Únicopag NÃO ecoa esse metadata de volta no
    // webhook nem no GET /transactions/:hash. Mantemos o envio porque não faz mal e pode ser
    // útil pra consulta manual no painel deles, mas o webhook (cursos.js) não depende disso
    // pra identificar a matrícula — ele casa pelo hash da transação (gatewayRef) e, na janela
    // de corrida, pelo CPF do cliente.
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
    // 🔥 CONFIGURAÇÃO COMPLETA: Enviando múltiplos identificadores para alinhar com o validador da nuvem
    cart: [{
      id: String(matriculaId),
      hash: String(matriculaId), // Fornece o hash exigido no erro 422
      title: nomeCurso,
      price: amountCentavos,
      quantity: 1,
      operation_type: 1 // 1 = Venda Direta (conforme especificado no documento)
    }]
  };

  if (isCredito && dadosCartao) {
    payload.card = {
      number: apenasNumeros(dadosCartao.numero),
      holdername: dadosCartao.titular,
      exp_month: String(dadosCartao.mesExpiracao).padStart(2, '0'),
      exp_year: String(dadosCartao.anoExpiracao),
      cvv: String(dadosCartao.cvv)
    };
  }

  console.log(`[MONITORAMENTO CARTÃO] ➡️ 1. Enviando Transação. Matrícula Original: ${matriculaId} | Método: ${paymentMethod}`);

  const urlFinal = `${baseUrl}${endpoint}?api_token=${token.trim()}`;

  // O domínio do Pix (vps1.unicopag.com.br) é separado do domínio do cartão
  // (api.cloud.unicopag.com.br, usado acima) e tem histórico de ficar lento/instável (504 do
  // nginx deles). Chegamos a testar um timeout curto (AbortController, 20s) aqui, mas isso
  // piorou o problema: em produção o webhook "transaction.created" costuma chegar durante a
  // espera do 504 real (que pode passar de 20s) — cortando a chamada mais cedo, a gente
  // cancelava o Pagamento ANTES do webhook ter chance de chegar e gravar o gatewayRef (ver
  // server.js e o catch em cursos.js), criando exatamente a mesma corrida que estávamos
  // tentando resolver. Por isso deixamos sem timeout aqui: se a Únicopag demorar, esperamos —
  // é o catch em cursos.js (com um pequeno período de tolerância) que decide se cancela ou não.
  const response = await fetch(urlFinal, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
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

  return {
    success: true,
    gatewayRef: String(result.hash || result.id || matriculaId),
    paymentStatus: result.payment_status || 'pending',
    installments: result.installments || (isCredito ? Number(dadosCartao.parcelas || 1) : 1),
    checkoutUrl: result.checkout_url || null,
    // 💡 CORRIGIDO (PIX): o campo real que a Únicopag devolve é "pix_qr_code" (confirmado tanto
    // na documentação oficial quanto em todo webhook real recebido em produção), não "qrcode".
    // O mesmo vale pra "pix_url". Com os nomes errados, pixQrCode e pixUrl sempre voltavam
    // null — a transação era criada normalmente do lado da Únicopag, só que a gente nunca
    // conseguia extrair o QR code da resposta pra mostrar pro aluno, mesmo sem nenhum erro de
    // rede ou timeout envolvido.
    pixQrCode: result.pix?.pix_qr_code || null,
    pixUrl: result.pix?.pix_url || null
  };
}

module.exports = { criarTransacao };