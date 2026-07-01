const API_BASE = 'https://api.cloud.unicopag.com.br';

function mapearMetodo(forma) {
  const mapa = { PIX: 'pix', CREDITO: 'credit_card', DEBITO: null, DINHEIRO: null };
  return mapa[forma] ?? null;
}

async function criarTransacao({ matriculaId, nomeCurso, valorTotal, forma, aluno, dfpId }) {
  const token = process.env.UNICOPAG_API_TOKEN;
  if (!token) throw new Error('UNICOPAG_API_TOKEN não configurado.');

  const metodo = mapearMetodo(forma);
  if (!metodo) throw new Error(`Forma "${forma}" não suportada pelo gateway.`);

  // Antifraude é obrigatório para cartão de crédito
  if (metodo === 'credit_card' && !dfpId) {
    throw new Error('dfp_id (ThreatMetrix) é obrigatório para pagamentos com cartão de crédito.');
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  console.log('[UnicopAg] APP_URL em uso:', appUrl);
  console.log('[UnicopAg] postback_url final:', `${appUrl}/webhook/unicopag`);

  const valorCentavos = Math.round(Number(valorTotal) * 100);
  const telefone = (aluno.celular || '').replace(/\D/g, '') || '00000000000';
  const documento = (aluno.cpfCnpj || '').replace(/\D/g, '');

  const body = {
    payment_method: metodo,
    amount: valorCentavos,
    installments: 1,
    postback_url: `${appUrl}/webhook/unicopag`,
    expire_in_days: 3,
    ...(dfpId ? { dfp_id: dfpId } : {}),
    customer: {
      name: aluno.nome,
      email: aluno.email,
      document: documento,
      phone_number: telefone,
    },
    cart: [
      {
        hash: matriculaId,
        title: nomeCurso,
        price: valorCentavos,
        quantity: 1,
        operation_type: 1,
      },
    ],
    metadata: { order_id: matriculaId },
  };

  // Log do payload completo (sem dados sensíveis de cartão, que nem existem aqui).
  console.log('[UnicopAg] Payload enviado:', JSON.stringify(body));

  const resp = await fetch(`${API_BASE}/public/v1/payments?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  console.log('[UnicopAg] Status HTTP:', resp.status, '| Resposta:', JSON.stringify(data));

  if (!resp.ok) {
    throw new Error(`${resp.status} - ${data?.message || 'Erro ao criar pagamento.'}`);
  }

  const checkoutUrl = data.link_checkout || null;
  const pixQrCode = data.pix?.pix_qr_code || null;
  const pixUrl = data.pix?.pix_url || null;
  const gatewayRef = data.hash ?? data.id;

  return { checkoutUrl, pixQrCode, pixUrl, gatewayRef, raw: data };
}

module.exports = { criarTransacao, mapearMetodo };